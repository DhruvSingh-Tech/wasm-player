#----------------------------------------------------------------
# Generated CMake target import file.
#----------------------------------------------------------------

# Commands may need to know the format version.
set(CMAKE_IMPORT_FILE_VERSION 1)

# Import target "EBML::ebml" for configuration ""
set_property(TARGET EBML::ebml APPEND PROPERTY IMPORTED_CONFIGURATIONS NOCONFIG)
set_target_properties(EBML::ebml PROPERTIES
  IMPORTED_LINK_INTERFACE_LANGUAGES_NOCONFIG "CXX"
  IMPORTED_LOCATION_NOCONFIG "${_IMPORT_PREFIX}/lib/libebml.a"
  )

list(APPEND _cmake_import_check_targets EBML::ebml )
list(APPEND _cmake_import_check_files_for_EBML::ebml "${_IMPORT_PREFIX}/lib/libebml.a" )

# Commands beyond this point should not need to know the version.
set(CMAKE_IMPORT_FILE_VERSION)
