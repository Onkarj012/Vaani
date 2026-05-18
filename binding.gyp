{
  "targets": [
    {
      "target_name": "vaani_native",
      "sources": [
        "src/native/accessibility/injector.mm",
        "src/native/accessibility/detector.mm",
        "src/native/hotkeys/hotkey_monitor.mm",
        "src/native/whisper/whisper_engine.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "CLANG_CXX_LIBRARY": "libc++",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "OTHER_CFLAGS": [
          "-ObjC++"
        ],
        "OTHER_LDFLAGS": [
          "-framework AppKit",
          "-framework ApplicationServices",
          "-framework Carbon",
          "-framework CoreAudio",
          "-framework CoreGraphics"
        ]
      },
      "libraries": [
        "-framework AppKit",
        "-framework ApplicationServices",
        "-framework Carbon",
        "-framework CoreAudio",
        "-framework CoreGraphics"
      ]
    }
  ]
}
