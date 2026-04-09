# Changelog

## [0.5.3](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.5.2...sqlitey-v0.5.3) (2026-04-09)


### Bug Fixes

* **install:** validate Turso .node matches host OS/arch ([af2661a](https://github.com/Ehesp/sqlitey/commit/af2661a01298b7948bb451ef89e6a1000e236f17))
* **release:** sync Turso .node for compile target, not CI host OS ([6e92b79](https://github.com/Ehesp/sqlitey/commit/6e92b79a0bc8f1a3e84e8b5509b2d9ff28fc0ca6))

## [0.5.2](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.5.1...sqlitey-v0.5.2) (2026-04-09)


### Bug Fixes

* resolve Turso sidecar when binary is named sqlitey ([f114be9](https://github.com/Ehesp/sqlitey/commit/f114be902a043637d9a17bfa46453f8ee8b4f296))

## [0.5.1](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.5.0...sqlitey-v0.5.1) (2026-04-09)


### Bug Fixes

* trigger patch release (docs-only changes did not bump version) ([189a71d](https://github.com/Ehesp/sqlitey/commit/189a71d9719120a33f4f38c190a2ed07c84a40d6))

## [0.5.0](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.4.0...sqlitey-v0.5.0) (2026-04-09)


### Features

* add persistent theming ([a69332e](https://github.com/Ehesp/sqlitey/commit/a69332e98f2f858f6c40a33d2fa759a6f5d6c9e7))

## [0.4.0](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.3.1...sqlitey-v0.4.0) (2026-04-09)


### Features

* switch to @tursodatabase/database and fix standalone release ([7baa06b](https://github.com/Ehesp/sqlitey/commit/7baa06b6aec7783e3e603cef42b39746eea18f57))


### Bug Fixes

* filter Turso/sqlite internal names with GLOB not LIKE ([53bb544](https://github.com/Ehesp/sqlitey/commit/53bb54446fdbe6fdc6a873def03f794129e24a7c))
* **release:** run bun-plugin-tailwind in Bun.build for compiled binaries ([a4c92d2](https://github.com/Ehesp/sqlitey/commit/a4c92d27f8f788f45e7e68046c80bf51edf965ab))

## [0.3.1](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.3.0...sqlitey-v0.3.1) (2026-04-09)

### Bug Fixes

- **release:** patch libsql dynamic require so bun compile embeds native addon ([e0481eb](https://github.com/Ehesp/sqlitey/commit/e0481eb1f15a3137cdbf7cbfa3daf93152777c87))

## [0.3.0](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.2.0...sqlitey-v0.3.0) (2026-04-09)

### ⚠ BREAKING CHANGES

- **release:** Windows arm64 release artifact removed until libsql ships win32-arm64-msvc.

### Bug Fixes

- **release:** embed libsql native addons in bun compile binaries ([28e6fd5](https://github.com/Ehesp/sqlitey/commit/28e6fd58b09750242fe648a4e8c1cd8ade93e40c))

## [0.2.0](https://github.com/Ehesp/sqlitey/compare/sqlitey-v0.1.0...sqlitey-v0.2.0) (2026-04-09)

### Features

- hello sqlitey ([65f8b88](https://github.com/Ehesp/sqlitey/commit/65f8b884b7519d6940f49d0be346879992d314b5))
