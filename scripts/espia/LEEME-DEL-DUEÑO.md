# El espía contra homologación de ARCA: cómo correrlo en tu computadora

Este programa prueba, contra el ambiente de **pruebas** de ARCA (homologación, sin valor fiscal), todo lo que el facturador
necesita antes de construir la conexión real: firmar el pedido de acceso, pedir el ticket, leer las tablas de códigos, emitir
facturas A, B y C de prueba, notas de crédito, consultar números y medir tiempos. Al final escribe un **informe en castellano**
(`informe.md`) y guarda las respuestas de ARCA **sin el ticket ni la firma** (dicen `[OCULTO]`).

- Vive en una rama **descartable** (`fiscal/f0-espia`): no entra al producto. Usa tres librerías que autorizaste solo para esta
  prueba (pkijs, asn1js y fast-xml-parser).
- **Desde la nube no se puede:** ARCA no es accesible desde la máquina donde trabajo. Por eso lo corrés vos.
- **No imprime ni guarda** tu clave privada, el ticket ni la firma. Nunca pegues la clave en un chat ni en un archivo del
  repositorio: el programa solo necesita la **ruta** al archivo.

## 0. Lo que necesitás

1. **Node 22 o más nuevo** y **git** instalados (`node --version` y `git --version` lo dicen).
2. Tu **certificado de homologación** (`.crt` o `.pem`) y **su clave** (`.key`), los que generaste en el WSASS (D3).
3. Que ese certificado tenga una **autorización** al servicio **wsfe** con la **CUIT representada** que vas a usar (en el WSASS:
   «Crear autorización a servicio»).
4. Un **punto de venta de homologación** habilitado para web services (factura electrónica, «RECE»). Si no tenés uno, ARCA lo
   rechaza y el informe lo va a decir.
5. Una **CUIT de prueba** para la factura A (otra CUIT, de otra persona o empresa; en homologación no se le manda nada real).

## 1. Bajar el programa (una sola vez)

**bash (Linux o Mac):**

```bash
git clone https://github.com/Alejandro-Gabriel-Pozo/zuluhub-erp.git zuluhub-espia
cd zuluhub-espia
git checkout fiscal/f0-espia
npm ci --ignore-scripts
```

**PowerShell (Windows):**

```powershell
git clone https://github.com/Alejandro-Gabriel-Pozo/zuluhub-erp.git zuluhub-espia
Set-Location zuluhub-espia
git checkout fiscal/f0-espia
npm ci --ignore-scripts
```

## 2. Probar que el programa anda (sin ARCA, un minuto)

Corre todo contra un ARCA **falso** que vive en tu computadora. No prueba nada de ARCA: solo que el programa funciona.

```bash
npm run espia -- --seco
```

(En PowerShell es igual.) Tiene que terminar mostrando E1 a E14 y la ruta de un `informe.md`.

## 3. Correrlo contra homologación

Poné los datos en variables de entorno **de esa terminal** (no quedan guardadas). Reemplazá lo que está entre `<…>`.

**bash:**

```bash
export ZULUHUB_ESPIA_CERTIFICADO="<ruta>/homologacion.crt"
export ZULUHUB_ESPIA_CLAVE="<ruta>/homologacion.key"
export ZULUHUB_ESPIA_CUIT="<CUIT representada, 11 dígitos sin guiones>"
export ZULUHUB_ESPIA_CUIT_TITULAR="<tu CUIT de persona física, la del certificado>"
export ZULUHUB_ESPIA_PUNTO_DE_VENTA="<número del punto de venta de homologación>"
export ZULUHUB_ESPIA_CUIT_RECEPTOR="<CUIT de prueba para la factura A>"
export ZULUHUB_ESPIA_SALIDA="$HOME/espia-salida"
# Opcional: la cadena de homologación para verificar el certificado (está en zuluhub-docs/12-referencias-externas/)
export ZULUHUB_ESPIA_CADENA="<ruta>/cadena-homologacion.pem"
npm run espia
```

**PowerShell:**

```powershell
$env:ZULUHUB_ESPIA_CERTIFICADO = "<ruta>\homologacion.crt"
$env:ZULUHUB_ESPIA_CLAVE = "<ruta>\homologacion.key"
$env:ZULUHUB_ESPIA_CUIT = "<CUIT representada, 11 dígitos sin guiones>"
$env:ZULUHUB_ESPIA_CUIT_TITULAR = "<tu CUIT de persona física, la del certificado>"
$env:ZULUHUB_ESPIA_PUNTO_DE_VENTA = "<número del punto de venta de homologación>"
$env:ZULUHUB_ESPIA_CUIT_RECEPTOR = "<CUIT de prueba para la factura A>"
$env:ZULUHUB_ESPIA_SALIDA = "$HOME\espia-salida"
# Opcional: la cadena de homologación para verificar el certificado
$env:ZULUHUB_ESPIA_CADENA = "<ruta>\cadena-homologacion.pem"
npm run espia
```

**Importante: ARCA da un ticket de acceso por certificado cada 12 horas** y no da otro mientras ese siga vigente. Si corrés el
espía dos veces en menos de 12 horas con el mismo certificado, la segunda vez E3 dice «ya hay un ticket vigente» y las pruebas
de facturas no corren (salvo que tengas el segundo alias del punto 4). Esperá 12 horas o usá el segundo alias.

## 4. El segundo alias (E1 y E4): una tarea a mano en el WSASS

E4 prueba si **un segundo certificado del mismo CUIT** obtiene su propio ticket mientras el primero sigue vigente (es el plan
de rescate si un ticket se pierde). Para eso hace falta un segundo certificado, y E1 prueba justamente que ZuluHub sabe generar
el pedido:

1. Corré el espía una vez con estas dos variables **además** de las del punto 3:
   - bash: `export ZULUHUB_ESPIA_ALIAS_NUEVO="zuluhub2"` y `export ZULUHUB_ESPIA_CLAVE_NUEVA="$HOME/claves-arca/zuluhub2.key"`
   - PowerShell: `$env:ZULUHUB_ESPIA_ALIAS_NUEVO = "zuluhub2"` y `$env:ZULUHUB_ESPIA_CLAVE_NUEVA = "$HOME\claves-arca\zuluhub2.key"`

   (Opcional: `ZULUHUB_ESPIA_ORGANIZACION` con el nombre de tu empresa.) La carpeta de la clave tiene que existir y **no** puede
   ser la de salida. El programa guarda ahí la clave nueva (solo vos la podés leer) y deja el pedido en
   `espia-salida/pedido-zuluhub2.csr`.

2. Entrá a ARCA con **tu** clave fiscal de persona física → servicio **«WSASS - Autogestión Certificados Homologación»**.
3. **«Nuevo Certificado»**: alias `zuluhub2`, tu CUIT, y pegá el contenido completo de `pedido-zuluhub2.csr` (desde
   `-----BEGIN CERTIFICATE REQUEST-----` hasta `-----END CERTIFICATE REQUEST-----`). Si el WSASS lo acepta, **E1 quedó
   aprobada**; guardá el certificado que te devuelve como `zuluhub2.crt` junto a su clave.
4. **«Crear autorización a servicio»**: alias `zuluhub2`, la **CUIT representada** (la de `ZULUHUB_ESPIA_CUIT`) y el servicio
   `wsfe`.
5. Volvé a correr el espía (punto 3) agregando:
   - bash: `export ZULUHUB_ESPIA_CERTIFICADO_2="$HOME/claves-arca/zuluhub2.crt"` y `export ZULUHUB_ESPIA_CLAVE_2="$HOME/claves-arca/zuluhub2.key"`
   - PowerShell: `$env:ZULUHUB_ESPIA_CERTIFICADO_2 = "$HOME\claves-arca\zuluhub2.crt"` y `$env:ZULUHUB_ESPIA_CLAVE_2 = "$HOME\claves-arca\zuluhub2.key"`

   (y sin `ZULUHUB_ESPIA_ALIAS_NUEVO`, que ya se usó).

Si el WSASS rechaza el pedido, copiá el mensaje exacto: es el resultado de E1 y decide si sirve la librería (decisión 13).

## 5. Qué me mandás

La carpeta de salida entera (`espia-salida`): `informe.md`, `resultados.json`, `tablas-de-arca.json` y `grabaciones/`. No
tiene credenciales (el programa se niega a escribir un archivo que contenga el ticket, la firma o una clave). Igual, si querés,
buscá en esa carpeta la palabra `PRIVATE`: no tiene que aparecer.

**No mandes** el `.key`, el `.crt` ni capturas de las variables.

## 6. Qué significa cada resultado

|     | Prueba                                                 | Aprobada quiere decir                                                                                                       |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| E1  | Generar clave y pedido (CSR) con la librería candidata | El pedido se armó y su firma verifica. **La aceptación del WSASS la confirmás vos** (punto 4)                               |
| E2  | Leer el certificado con lo que trae Node, sin librería | Se lee, la clave corresponde y (si diste la cadena) la cadena verifica                                                      |
| E3  | Firmar el pedido de acceso con SHA-256 y SHA-1         | ARCA dio un ticket con al menos una de las dos (el informe dice cuál)                                                       |
| E4  | Otro ticket con uno vigente; segundo alias             | Informativa: el error exacto de ARCA, y si el segundo alias obtiene su ticket                                               |
| E5  | Prueba de vida y las seis tablas de códigos            | Responden; las tablas quedan en `tablas-de-arca.json`                                                                       |
| E6  | Último número autorizado de cada tipo                  | Responde un número                                                                                                          |
| E7  | Factura B a consumidor final, dos alícuotas            | Resultado A, sin errores de importes                                                                                        |
| E8  | Factura A a la CUIT de prueba                          | Resultado A (si no, el error queda anotado)                                                                                 |
| E9  | Factura C                                              | Resultado A o el error exacto (un emisor responsable inscripto no emite C)                                                  |
| E10 | Notas de crédito total, parcial y mayor que la factura | Resultado A; la mayor con la observación 10237                                                                              |
| E11 | Reenviar un número ya autorizado                       | Informativa: qué responde ARCA (confirma por qué nunca reenviamos a ciegas)                                                 |
| E12 | Consultar un número existente y uno inexistente        | El existente trae su CAE; el inexistente, el código 602                                                                     |
| E13 | TLS desde Vercel (`gru1`)                              | **Pendiente: necesita despliegue.** Igual se anota el TLS desde tu computadora y si responde el dominio nuevo `arca.gob.ar` |
| E14 | Tiempos de cada operación                              | Informativa                                                                                                                 |

## 7. Si algo sale mal

- «falta la variable …»: te faltó definir esa variable en **esta** terminal.
- «no se pudo leer …»: la ruta está mal (en Windows, con `\`; si tiene espacios, entre comillas).
- E3 con `cms.cert.untrusted` o similar: el certificado no es de homologación o venció.
- E5 a E12 con `600`/`601`: el certificado no tiene la autorización a `wsfe` para la CUIT representada (punto 0.3).
- Todo sin respuesta (`ENOTFOUND`, `ECONNREFUSED`, `TIEMPO_AGOTADO`): tu red no llega a ARCA (probá otra red o sin VPN).
