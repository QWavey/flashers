# ESP-S3-Key BadUSB WebFlasher

WebSerial + esptool-js flasher for the ESP32-S3-Dongle "USB Key" BadUSB
firmware. Runs entirely in the browser (Chrome / Edge) — no toolchain,
no command line.

**Live:** https://qwavey.github.io/flashers/esp-s3-key/
**Firmware source:** https://github.com/QWavey/ESP-S3-Key-BadUSB
**Hub:** https://qwavey.github.io/flashers/ (also in this repo, one level up)

## Layout

```
index.html            single-screen wizard
css/style.css         design tokens
js/flasher.js         WebSerial + esptool-js bring-up + progress
firmware/             bootloader.bin, partitions.bin, boot_app0.bin,
                      firmware.bin, manifest.json
vendor/               esptool-bundle.js (esptool-js UMD build)
favicon.svg
hardware.jpg          reference photo of the board
```

## Update flow

Firmware changes land in
[QWavey/ESP-S3-Key-BadUSB](https://github.com/QWavey/ESP-S3-Key-BadUSB).
Regenerate the flasher with:

```bash
python /path/to/flasher-forge/flasher-out/build_esp_s3_key_flasher.py
```

and drop the output over `esp-s3-key/`. Pages redeploys on push.
