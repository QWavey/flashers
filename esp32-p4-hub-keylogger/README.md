# ESP32-P4 Hub Keylogger — unified WebFlasher

Flashes both halves of QWavey's ESP32-P4 hub keylogger port for the Spotpear
ESP32-P4-MINI-B-M-EXT in one page: the ESP32-P4 (HID + MSC composite) and
the on-board ESP32-C6-MINI (Wi-Fi web UI). The wizard walks you through the
U4 switch move between the two chips.

Runs entirely in your browser over WebSerial via esptool-js — no toolchain,
no command line. Source: https://github.com/QWavey/esp32-p4-hub-keylogger
