import './style.css';
import videojs from 'video.js';
import './tech/MkvWasmTech.js';

const player = videojs('my-player', {
  techOrder: ['MkvWasm'], // Force use of our custom tech
  sources: [{
    src: 'https://pub-6b25c191839c4b01a878de4fdde0227b.r2.dev/8d8118cffa904fe68b8c02f562c36160?token=1765856945',
    // src: '/test5.mkv',
    // src: "https://0.ios37.workers.dev/ec86f8d15aed59884492ded48419adfa/driveseed.org/The.Fantastic.Four.First.Steps.2025.Imax.1080P.10bit.Web-Dl.Hindi.English.Msubs.MoviesMod.plus.mkv",
    type: 'video/x-matroska'
  }]
});

// Handle Playback manually if Video.js fails to bridge the event
// Handle Playback manually if Video.js fails to bridge the event
player.ready(() => {
  console.log('Player Ready');

  // Audio Track Switching UI (Standard Video.js)
  const audioTrackList = player.audioTracks();
  audioTrackList.on('change', function () {
    console.log('Audio track changed');
    // The Tech handles the switch internally upon receiving the event or querying the active track
  });

  player.on('durationchange', () => {
    console.log('Player durationchange:', player.duration());
  });
  player.on('loadedmetadata', () => {
    console.log('Player loadedmetadata. Duration:', player.duration());
  });
  player.on('canplay', () => {
    console.log('Player canplay. Duration:', player.duration(), 'Seekable:', player.seekable());
  });
});

// Debug: Force Play Button (Global)
const btn = document.createElement('button');
btn.innerText = 'FORCE PLAY';
btn.style.position = 'fixed';
btn.style.top = '10px';
btn.style.left = '10px';
btn.style.zIndex = '9999';
btn.style.padding = '10px 20px';
btn.style.background = 'red';
btn.style.color = 'white';
btn.onclick = () => {
  console.log('Force Play Clicked');
  const tech = player.tech({ IWillNotUseThisInPlugins: true });
  if (tech && tech.play) {
    console.log('Calling tech.play() DIRECTLY');
    console.log('Tech duration_:', tech.duration_);
    console.log('Tech duration():', tech.duration());
    console.log('Player duration():', player.duration());
    console.log('Tech seekable():', tech.seekable());
    console.log('Tech readyState:', tech.readyState);
    tech.play();

    // Force update player duration after a delay
    setTimeout(() => {
      const dur = tech.duration();
      console.log('After delay - Tech duration:', dur);
      console.log('Before manual set - Player duration:', player.duration());

      if (dur > 0) {
        // Manually set player duration and cache
        player.cache_ = player.cache_ || {};
        player.cache_.duration = dur;
        player.duration_ = dur; // Some versions use this

        player.trigger('durationchange');
        console.log('After manual set - Player duration:', player.duration());
        console.log('Player cache_:', player.cache_);

        // Force UI update
        if (player.controlBar && player.controlBar.durationDisplay) {
          player.controlBar.durationDisplay.updateContent();
          console.log('Updated durationDisplay');
        }

        // Debug seek bar state
        console.log('Player seekable():', player.seekable());
        console.log('Player liveTracker:', player.liveTracker ? player.liveTracker.isLive() : 'no liveTracker');
        console.log('SeekBar:', player.controlBar?.progressControl?.seekBar);

        // Check if seek bar is interactive
        const seekBar = player.controlBar?.progressControl?.seekBar;
        if (seekBar) {
          console.log('SeekBar enabled:', !seekBar.hasClass('vjs-disabled'));
        }
      }
    }, 500);
  } else {
    console.error('Tech not found or no play method');
  }
};

// Listen for seeking events
player.on('seeking', () => {
  console.log('Player seeking event! CurrentTime:', player.currentTime());
});
player.on('seeked', () => {
  console.log('Player seeked event! CurrentTime:', player.currentTime());
});

// Listen for timeupdate to verify it's firing
let timeupdateCount = 0;
player.on('timeupdate', () => {
  timeupdateCount++;
  if (timeupdateCount <= 5 || timeupdateCount % 100 === 0) {
    console.log('Player timeupdate #' + timeupdateCount + ', currentTime:', player.currentTime());
  }
});

// WORKAROUND: Override player.currentTime() to properly read from tech
const originalCurrentTime = player.currentTime.bind(player);
player.currentTime = function (seconds) {
  const tech = player.tech({ IWillNotUseThisInPlugins: true });

  // Setter
  if (typeof seconds !== 'undefined') {
    if (tech && tech.setCurrentTime) {
      tech.setCurrentTime(seconds);
    }
    return player;
  }

  // Getter - get from tech directly
  if (tech && tech.currentTime) {
    return tech.currentTime();
  }

  return originalCurrentTime();
};
document.body.appendChild(btn);

player.on('error', (e) => {
  console.error('Player Error:', player.error());
});

// Test Seek Button
const seekBtn = document.createElement('button');
seekBtn.innerText = 'SEEK TO 60s';
seekBtn.style.position = 'fixed';
seekBtn.style.top = '10px';
seekBtn.style.left = '150px';
seekBtn.style.zIndex = '9999';
seekBtn.style.padding = '10px 20px';
seekBtn.style.background = 'blue';
seekBtn.style.color = 'white';
seekBtn.onclick = () => {
  console.log('Seek button clicked');
  const tech = player.tech({ IWillNotUseThisInPlugins: true });
  console.log('Before seek - Player currentTime:', player.currentTime());
  console.log('Before seek - Tech currentTime:', tech.currentTime());

  // Call Tech directly since player.currentTime() isn't routing properly
  tech.setCurrentTime(60);

  console.log('After seek call - Tech currentTime:', tech.currentTime());
};
document.body.appendChild(seekBtn);
