#define private public
#define protected public

#include <iostream>
#include <vector>
#include <string>
#include <memory>
#include <algorithm>
#include <cstring>

// Emscripten
#include <emscripten/emscripten.h>
#include <emscripten/bind.h>

// LibMatroska / LibEBML
#include <ebml/IOCallback.h>
#include <ebml/EbmlHead.h>
#include <ebml/EbmlContexts.h>
#include <ebml/EbmlStream.h>
#include <ebml/EbmlVoid.h>
#include <matroska/KaxSegment.h>
#include <matroska/KaxTracks.h>
// #include <matroska/KaxTrackEntryData.h>
#include <matroska/KaxCluster.h>
#include <matroska/KaxBlockData.h>
#include <matroska/KaxDefines.h>

using namespace emscripten;
using namespace libmatroska;
using namespace libebml;

// Dummy stack guard to satisfy link error since dependencies were built with stack protection
extern "C" {
    uintptr_t __stack_chk_guard = 0xDEADBEEF;
    void __stack_chk_fail(void) {
        std::abort();
    }
}

// ---------------------------------------------------------------------------
// Custom IOCallback
// ---------------------------------------------------------------------------
class MemIOCallback : public IOCallback {
    std::vector<uint8_t> buffer;
    uint64_t cursor;       
    uint64_t total_offset; 
public:
    MemIOCallback() : cursor(0), total_offset(0) {}

    uint64_t available() const {
        return buffer.size();
    }
    
    // Called by JS to append data
    void push_data(const std::string& data) {
        std::vector<uint8_t> chunk(data.begin(), data.end());
        buffer.insert(buffer.end(), chunk.begin(), chunk.end());
    }
    
    // ...

    // Garbage removed

    size_t read(void* outputBuffer, size_t size) override {
        if (cursor >= buffer.size()) return 0;
        size_t available = buffer.size() - cursor;
        size_t to_read = std::min(size, available);
        std::memcpy(outputBuffer, &buffer[cursor], to_read);
        cursor += to_read;
        return to_read;
    }

    void setFilePointer(int64_t offset, seek_mode mode = seek_beginning) override {
         int64_t target = 0;
         if (mode == seek_beginning) target = offset;
         else if (mode == seek_current) target = getFilePointer() + offset;
         else if (mode == seek_end) return; 
         
         int64_t local_target = target - total_offset;
         if (local_target >= 0 && local_target <= (int64_t)buffer.size()) {
             cursor = local_target;
         }
    }

    uint64_t getFilePointer() override {
        return total_offset + cursor;
    }
    
    size_t write(const void* buffer, size_t size) override { return 0; }
    void close() override {}
    // Removed setOwner and writeFully as they are not in IOCallback
};


// ---------------------------------------------------------------------------
// MkvDemuxer Class
// ---------------------------------------------------------------------------
class MkvDemuxer {
    MemIOCallback io_callback;
    EbmlStream* stream;
    std::unique_ptr<KaxSegment> segment;
    
public:
    MkvDemuxer() {
        stream = new EbmlStream(io_callback);
    }
    
    ~MkvDemuxer() {
        delete stream;
    }

    void push_data(const std::string& data) {
         io_callback.push_data(data);
    }

    val get_metadata() {
        EbmlElement* el = stream->FindNextID(EbmlHead::ClassInfos, 0xFFFFFFFF);
        if (el) {
            el->SkipData(*stream, el->Context());
            delete el;
        }

        el = stream->FindNextID(KaxSegment::ClassInfos, 0xFFFFFFFF);
        if (!el) return val::null();

        if (EbmlId(*el) == KaxSegment::ClassInfos.GlobalId) {
            segment.reset(static_cast<KaxSegment*>(el));
        } else {
             delete el;
             return val::null(); 
        }

        val metadata = val::object();
        metadata.set("duration", 0);
        
        int upperLevel = 0;
        int dummyUpper = 0;
        
        // Loop elements
        while ((el = stream->FindNextElement(segment->Context(), upperLevel, 0xFFFFFFFF, true, 1)) != NULL) {
             if (upperLevel > 0) {
                 break; 
             }
             if (EbmlId(*el) == KaxTracks::ClassInfos.GlobalId) {
                 KaxTracks* tracks = static_cast<KaxTracks*>(el);
                 tracks->Read(*stream, KaxTracks::ClassInfos.Context, dummyUpper, el, true);
                 
                 for (size_t i = 0; i < tracks->ListSize(); i++) {
                     KaxTrackEntry* entry = static_cast<KaxTrackEntry*>((*tracks)[i]);
                     if (!entry) continue;

                      // Find TrackType
                      uint8_t trackType = 0;
                      std::string codecId = "";
                      uint64_t trackNum = 0;
                      val codecPrivate = val::null();
                      uint64_t width = 0;
                      uint64_t height = 0;
                      
                      // Iterate children of Entry manually
                      for (size_t j = 0; j < entry->ListSize(); j++) {
                          EbmlElement* e = (*entry)[j];
                          if (EbmlId(*e) == KaxTrackType::ClassInfos.GlobalId) {
                              KaxTrackType* tType = static_cast<KaxTrackType*>(e);
                              trackType = uint8_t(*tType);
                          } else if (EbmlId(*e) == KaxCodecID::ClassInfos.GlobalId) {
                              KaxCodecID* cId = static_cast<KaxCodecID*>(e);
                              codecId = std::string(*cId);
                          } else if (EbmlId(*e) == KaxTrackNumber::ClassInfos.GlobalId) {
                              KaxTrackNumber* tn = static_cast<KaxTrackNumber*>(e);
                              trackNum = uint64_t(*tn);
                          } else if (EbmlId(*e) == KaxCodecPrivate::ClassInfos.GlobalId) {
                              KaxCodecPrivate* cp = static_cast<KaxCodecPrivate*>(e);
                              if (cp->GetSize() > 0) {
                                  // Manual copy using Array because of potential Binding issues with TypedArrays in this context?
                                  // Let's safe copy to JS array first.
                                  val arr = val::array();
                                  const uint8_t* cpBuf = cp->GetBuffer();
                                  for(size_t k=0; k<cp->GetSize(); k++) {
                                      arr.call<void>("push", cpBuf[k]);
                                  }
                                  // Convert to Uint8Array in JS side or keep as Array?
                                  // Let's return Uint8Array directly if safe, or Array.
                                  // Using Array is safer for now.
                                  codecPrivate = arr;
                              }
                          } else if (EbmlId(*e) == KaxTrackVideo::ClassInfos.GlobalId) {
                              KaxTrackVideo* vid = static_cast<KaxTrackVideo*>(e);
                              // Iterate video properties
                              for (size_t k = 0; k < vid->ListSize(); k++) {
                                  EbmlElement* ve = (*vid)[k];
                                  if (EbmlId(*ve) == KaxVideoPixelWidth::ClassInfos.GlobalId) {
                                      width = uint64_t(*static_cast<KaxVideoPixelWidth*>(ve));
                                  } else if (EbmlId(*ve) == KaxVideoPixelHeight::ClassInfos.GlobalId) {
                                      height = uint64_t(*static_cast<KaxVideoPixelHeight*>(ve));
                                  }
                              }
                          }
                      }
                      
                      if (trackType == track_video) {
                             val videoTrack = val::object();
                             videoTrack.set("trackId", (int)trackNum);
                             videoTrack.set("codec", "avc1.64001E"); // Fallback or map from codecId
                             if (codecPrivate.as<bool>()) {
                                 videoTrack.set("description", codecPrivate);
                             }
                             videoTrack.set("codedWidth", (int)width > 0 ? (int)width : 1280); 
                             videoTrack.set("codedHeight", (int)height > 0 ? (int)height : 720);
                             metadata.set("videoTrack", videoTrack);
                      }
                 }
                 break; // Found tracks
             }
             
             // Skip
             el->SkipData(*stream, el->Context());
             delete el;
        }

        return metadata;
    }

    int cluster_search_pos = 0; // State for FindNextElement
    std::vector<val> queued_packets; // Declare here

    val read_queued_packet() {
          // Deprecated, logic moved to read_packet
          return val::null();
    }
    val read_packet() {
        // Return queued packets first
        if (!queued_packets.empty()) {
            val p = queued_packets.front();
            queued_packets.erase(queued_packets.begin());
            return p;
        }

        if (!segment) return val::null();
        
        EbmlElement* el = nullptr;
        int dummyBound = 0; 
        
        // Find next Cluster
        // Find next Cluster
        while ((el = stream->FindNextElement(segment->Context(), cluster_search_pos, 0xFFFFFFFF, true, 1)) != NULL) {
            
            // Check availability
            uint64_t neededEnd = el->GetElementPosition() + el->HeadSize() + el->GetSize();
            
            // Use member directly
            if (neededEnd > io_callback.available()) {
                 delete el;
                 
                 // Reset stream position in the callback to retry later
                 io_callback.setFilePointer(el->GetElementPosition());
                 
                 return val::null();
            }

            if (EbmlId(*el) == KaxCluster::ClassInfos.GlobalId) {
                // EM_ASM({ console.log('C++: Found Cluster'); });
                KaxCluster* cluster = static_cast<KaxCluster*>(el);
                try {
                    cluster->Read(*stream, KaxCluster::ClassInfos.Context, dummyBound, el, true);
                } catch (...) {
                    delete cluster;
                    return val::null();
                }
                
                // Find Timestamp first and Initialize Cluster
                uint64_t clusterTimecode = 0;
                bool foundTimecode = false;
                for (size_t k = 0; k < cluster->ListSize(); k++) {
                     EbmlElement* subEl = (*cluster)[k];
                     if (subEl && EbmlId(*subEl) == KaxClusterTimestamp::ClassInfos.GlobalId) {
                         KaxClusterTimestamp* tc = static_cast<KaxClusterTimestamp*>(subEl);
                         clusterTimecode = uint64_t(*tc);
                         foundTimecode = true;
                         break;
                     }
                }
                
                if (foundTimecode) {
                    // EM_ASM({ console.log('C++: InitTimestamp ' + $0); }, (double)clusterTimecode);
                    cluster->InitTimestamp(clusterTimecode, 1000000);
                }
                
                // Iterate elements inside Cluster to find SimpleBlocks
                for (size_t i = 0; i < cluster->ListSize(); i++) {
                     EbmlElement* e = (*cluster)[i];
                     if (!e) continue;
                     
                     if (EbmlId(*e) == KaxSimpleBlock::ClassInfos.GlobalId) {
                         // EM_ASM({ console.log('C++: Processing SimpleBlock'); });
                         KaxSimpleBlock* block = static_cast<KaxSimpleBlock*>(e);
                         block->SetParent(*cluster); 

                         if (block->NumberFrames() == 0) continue; 
                         
                         DataBuffer& db = block->GetBuffer(0);
                         size_t size = db.Size();
                         uint8_t* data = db.Buffer();
                         
                         if (!data || size == 0) continue;
                         
                         int trackNum = block->TrackNum();
                         
                         // Timestamp calc
                         int16_t relativeTime = block->GetRelativeTimestamp();
                         uint64_t timestamp = (clusterTimecode * 1000000) + ((int64_t)relativeTime * 1000000); 

                         val packet = val::object();
                         packet.set("trackId", trackNum);
                         packet.set("timestamp", (double)timestamp / 1000000.0);
                         packet.set("isKey", block->IsKeyframe());
                         
                         // Debug: data size
                         // EM_ASM({ console.log('C++: Data Size: ' + $0); }, size);
                         
                         // Slow copy to JS Array to verify stability
                         val jsData = val::array();
                         for (size_t x = 0; x < size; x++) {
                             jsData.call<void>("push", data[x]);
                         }
                         
                         packet.set("data", jsData);
                         
                         queued_packets.push_back(packet);
                     }
                }
                // EM_ASM({ console.log('C++: Cluster Done'); });
                delete cluster;
                
                if (!queued_packets.empty()) {
                    val p = queued_packets.front();
                    queued_packets.erase(queued_packets.begin());
                    return p;
                }
            } else {
                 el->SkipData(*stream, el->Context());
                 delete el;
            }
        }
        
        return val::null();
    }

};

EMSCRIPTEN_BINDINGS(my_module) {
    class_<MkvDemuxer>("MkvDemuxer")
        .constructor<>()
        .function("push_data", &MkvDemuxer::push_data)
        .function("get_metadata", &MkvDemuxer::get_metadata)
        .function("read_packet", &MkvDemuxer::read_packet);
}
