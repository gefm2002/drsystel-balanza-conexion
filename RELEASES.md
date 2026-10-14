# Releases — instalador del puente de balanza (Erp Los Hermanos)

Copia de la distribución de `matiaspautasso/erp-los-hermanos-releases`: instalador del puente de
balanza de Erp Los Hermanos (binarios; el código fuente vive en el repo privado
`erp-los-hermanos`, carpeta `app/bridge`).

Los instaladores están adjuntos a los **Releases** de este repo, con el mismo tag.

> Este repo es **privado**: la PC de caja no puede descargar el instalador desde acá sin iniciar
> sesión en GitHub. La descarga pública que usa el botón del ERP
> (`VITE_BALANZA_PUENTE_INSTALADOR_URL`) sigue siendo la de `erp-los-hermanos-releases`.

| Tag | Fecha | Instalador | SHA256 |
|---|---|---|---|
| `bridge-v1.1.0` | 2026-10-14 | `PuenteBalanza-Setup-1.1.0.exe` | `08ed13670c937a8b012a4c07e071805aaf157c2caf3d151c646531d9566a8775` |
| `bridge-v1.0.0` | 2026-09-25 | `PuenteBalanza-Setup-1.0.0.exe` | `c45812d4162f8df9ff7d2b7df4f146b3d2dffbc85faafb3ed221552714aecbef` |

## 1.1.0

Autodetección del puerto COM de la balanza (adaptador FTDI, VID 0403 / PID 6001):
`BALANZA_COM=auto` por defecto; con un COM fijo que no abre, usa el FTDI detectado. Actualizar
encima conserva `config.env` y `data\`.

## 1.0.0

Primera versión del instalador (Inno Setup, Windows x64): `puente-balanza.exe` + inicio
automático con la tarea programada `ErpLosHermanos-PuenteBalanza`.
