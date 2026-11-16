/**
 * Reglas de dependencia de la interfaz, la composición, las apps y los adaptadores de terceros (R-W6 en adelante), en archivo propio para que
 * `reglas.cjs` (sobre el tope de líneas del libro de deuda, `arquitectura/deuda`) baje del tope; `reglas.cjs` las suma a su lista en el
 * mismo orden en que estaban. Las rutas son relativas a la raíz del repositorio. Todas con severidad `error` y su violación inyectada en
 * `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    // R-W6. Previene: íconos sueltos sin nombre accesible ([02] §4.3) y un juego de íconos repartido por
    // toda la web (cambiarlo tocaría cada pantalla). Chequeo: la violación inyectada de reglas.test.ts.
    name: "iconos-solo-por-su-puerta",
    severity: "error",
    comment:
      "`lucide-react` solo se importa desde apps/web/ui/iconos/ (R-W6): ahí cada ícono sale del catálogo cerrado y con su nombre accesible o declarado decorativo.",
    from: { path: "^(src|apps)/", pathNot: "^apps/web/ui/iconos/" },
    to: { path: "^(node_modules/)?lucide-react(/|$)" },
  },
  {
    // R-W7. Previene: un componente que sabe de un módulo o de una pantalla ([01] §3.1): la interfaz base
    // (capas 1 a 5) no conoce ningún módulo ni la composición. Chequeo: la violación inyectada de reglas.test.ts.
    name: "ui-sin-pantallas-ni-modulos",
    severity: "error",
    comment:
      "apps/web/ui/** (capas 1 a 5) no importa apps/web/pantallas/**, apps/web/servidor/** ni src/modulos/** (R-W7): la interfaz base no conoce ninguna pantalla ni módulo.",
    from: { path: "^apps/web/ui/" },
    to: { path: "^apps/web/(pantallas|servidor)/|^src/modulos/" },
  },
  {
    name: "composicion-solo-desde-servidor-de-apps",
    severity: "error",
    comment:
      "R-W2. Ningún .tsx ni archivo de apps/** importa src/composicion salvo apps/web/servidor/** y apps/plataforma/servidor/** (que es solo servidor). Previene que un componente arme adaptadores y, con ellos, secretos.",
    from: { path: "\\.tsx$|^apps/", pathNot: "^apps/(web|plataforma)/servidor/" },
    to: { path: "^src/composicion/" },
  },
  {
    name: "cliente-sin-servidor",
    severity: "error",
    comment:
      'R-W4. Los archivos de cliente (*.cliente.tsx; todo archivo con "use client" lleva ese sufijo) no importan publico.ts de ningún módulo, ni la composición, ni los adaptadores, ni apps/*/servidor. Previene persistencia y pg en el paquete del navegador (hallazgo H5 del spec de la web). Las formas (formas.ts) sí se pueden importar.',
    from: { path: "\\.cliente\\.tsx$" },
    to: {
      path: "^src/modulos/[^/]+/publico\\.ts$|^src/(composicion|adaptadores)/|^apps/[^/]+/servidor/",
    },
  },
  {
    name: "formas-sin-negocio",
    severity: "error",
    comment:
      "R-W5. formas.ts de un módulo solo importa zod y primitivas: son esquemas de la forma de un dato, sin negocio. Previene que la pantalla tenga que importar publico.ts (con persistencia) solo para tener la forma, o que la forma decida reglas que son del dominio.",
    from: { path: "^src/modulos/[^/]+/formas\\.ts$" },
    to: { pathNot: "^src/primitivas/|^(node_modules/)?zod(/|$)" },
  },
  {
    name: "fiscal-sin-negocio-ajeno",
    severity: "error",
    comment:
      "El facturador funciona solo (facturación §B.0 y §B.9): fiscal no importa ventas, caja, catálogo, clientes ni stock, ni siquiera por su publico.ts. Quien factura le da renglones, un receptor y un origen opaco. Previene que fiscal dependa de un módulo que lo usa y rompa la separación; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/fiscal/" },
    to: { path: "^src/modulos/(ventas|caja|catalogo|clientes|stock)/" },
  },
  {
    // F8. Previene: que la firma CMS (que maneja la clave privada del cliente) y la lectura de XML que viene de un
    // servicio externo (entidades, DOCTYPE) se repartan por el producto: cada uso afuera del adaptador sería otra
    // superficie por donde una clave o una entidad maliciosa entra o sale. Chequeo: las violaciones inyectadas de
    // reglas.test.ts.
    name: "arca-solo-en-su-adaptador",
    severity: "error",
    comment:
      "pkijs, asn1js y fast-xml-parser (la firma CMS del pedido de acceso, el pedido y la lectura de certificados, y la lectura de las respuestas de ARCA) solo se importan en los adaptadores de ARCA y de certificados, src/adaptadores/arca y src/adaptadores/certificados (decisión 13 y D5; facturación §B.5.7). Ni el dominio, ni los casos de uso, ni las apps, ni otro adaptador.",
    from: { path: "^(src|apps|scripts)/", pathNot: "^src/adaptadores/(arca|certificados)/" },
    to: { path: "^(node_modules/)?(pkijs|asn1js|fast-xml-parser)(/|$)" },
  },
  {
    // F8. Previene: un adaptador que lee la base por su cuenta o que depende de un módulo de negocio que no es el
    // que sirve. Kysely ya está prohibido afuera de la persistencia (`orm-solo-en-persistencia`); esto cierra el
    // otro camino. Chequeo: las violaciones inyectadas de reglas.test.ts.
    name: "adaptador-arca-solo-con-fiscal",
    severity: "error",
    comment:
      "src/adaptadores/arca no importa ningún módulo salvo fiscal/publico.ts (facturación §B.9): el adaptador traduce lo de fiscal a ARCA y no conoce ningún otro módulo de negocio ni sus datos.",
    from: { path: "^src/adaptadores/arca/" },
    to: { path: "^src/modulos/", pathNot: "^src/modulos/fiscal/publico\\.ts$" },
  },
  {
    // W3b (web-armazon §3.1 y §4.1). Previene: la librería de ingreso importada desde una acción, una
    // pantalla o un módulo, que ataría el resto del código a su versión (1.7.7 exacta, con ganchos propios
    // acoplados a sus rutas internas) y a su forma de leer la sesión y el host. Todo el resto usa el puerto
    // `Autenticacion`. Chequeo: la violación inyectada de reglas.test.ts.
    name: "better-auth-solo-en-su-adaptador",
    severity: "error",
    comment:
      "`better-auth` (y @better-auth/*) solo se importa en src/adaptadores/autenticacion/: el resto de la aplicación usa el puerto Autenticacion (src/puertos/autenticacion.ts).",
    from: { path: "^(src|apps)/", pathNot: "^src/adaptadores/autenticacion/" },
    to: { path: "^(node_modules/)?(better-auth(/|$)|@better-auth/)" },
  },
  {
    // P8a y F9 (h5-p8 §2.4 ter; `qrcode-generator` 2.0.4 exacta, aprobada por el dueño, también para la factura, 2026-11-03).
    // Previene: que el generador del QR, que recibe textos sensibles (la dirección `otpauth://` con el SECRETO del segundo
    // factor, la URL de una factura), se importe desde otro lugar y el texto termine dibujado, registrado o mandado donde
    // nadie lo revisó, o que el dibujo se copie en cada uso. Lo importa UN solo lugar, `src/adaptadores/qr/` (ADR-014: dos
    // usos reales). Chequeo: la violación inyectada de reglas.test.ts.
    name: "qr-solo-en-su-adaptador",
    severity: "error",
    comment:
      "`qrcode-generator` solo se importa en src/adaptadores/qr/: dibuja el QR de textos sensibles (la dirección otpauth con el secreto TOTP, la URL de la factura) y es el único lugar que lo hace (h5-p8 §2.4 ter).",
    from: {
      path: "^(src|apps|scripts)/",
      pathNot: "^src/adaptadores/qr/",
    },
    to: { path: "^(node_modules/)?qrcode-generator(/|$)" },
  },
  {
    // R-W4b. Next obliga a que el límite de errores se llame `error.tsx` (y `global-error.tsx`) y lleve la
    // directiva de cliente, así que no puede llevar el sufijo `.cliente.tsx` de R-W4. Estos archivos solo
    // reexportan el componente (lo exige la prueba de convenciones) y valen lo mismo que uno de cliente.
    // Previene: persistencia, composición o `pg` en el paquete del navegador por la puerta de los errores.
    // Chequeo: la violación inyectada de reglas.test.ts.
    name: "error-de-next-sin-servidor",
    severity: "error",
    comment:
      "R-W4b. Los error.tsx / global-error.tsx de apps/*/app (clientes por obligación de Next) no importan publico.ts de ningún módulo, ni la composición, ni los adaptadores, ni apps/*/servidor.",
    from: {
      path: "^apps/[^/]+/app/(global-)?error\\.tsx$|^apps/[^/]+/app/.+/(global-)?error\\.tsx$",
    },
    to: {
      path: "^src/modulos/[^/]+/publico\\.ts$|^src/(composicion|adaptadores)/|^apps/[^/]+/servidor/",
    },
  },
  {
    // M6 / H5 P5 (ADR-007). Previene: un caso de plataforma que manda el mail (el de la invitación del
    // gerente, por ejemplo) desde adentro de su transacción SERIALIZABLE, que el adaptador repite entera
    // ante un conflicto: el mail saldría dos veces, o saldría de un alta que después se revierte. Los
    // efectos externos se piden encolando un trabajo (`Trabajos.encolar`) en la misma transacción y los
    // envía el procesador de la cola cuando ya confirmó. Chequeo: la violación inyectada de reglas.test.ts.
    name: "plataforma-sin-correo",
    severity: "error",
    comment:
      "Los casos de uso de plataforma no envían correo: encolan un trabajo (ADR-007) y lo envía el procesador de la cola fuera de la transacción.",
    from: { path: "^src/plataforma/" },
    to: { path: "^src/puertos/correo\\.ts$|^src/adaptadores/correo/" },
  },
  {
    // P7 y P8b. Previene: que `apps/web` (o cualquier parte de `src/`) obtenga la puerta de plataforma y con ella la
    // credencial del rol `pedernal_plataforma`: un error de la web podría actuar como plataforma (R10). Y, desde P8b,
    // que la consola `apps/plataforma` ejecute un caso SIN pasar por la sesión: `plataforma.ts` (que corre casos con
    // un contexto armado por quien llama, sin la comprobación del segundo factor reciente) es solo de los scripts del
    // dueño y de las pruebas; la consola entra por `puerta-de-consola.ts` y `ingreso-de-consola.ts` (reglas siguientes).
    // Alcance: `plataforma.ts` y `entorno-de-plataforma.ts` solo los importan `scripts/`, las pruebas (`test/` y los
    // `*.test.ts`), la puerta de la consola, el ingreso de la consola (que lee de acá sus variables) y ellos mismos.
    // Chequeo: las violaciones inyectadas de reglas.test.ts.
    name: "plataforma-solo-desde-scripts",
    severity: "error",
    comment:
      "src/composicion/plataforma.ts y entorno-de-plataforma.ts (la puerta de plataforma sin sesión y su credencial) solo los importan scripts/, las pruebas y la composición de la consola (puerta-de-consola.ts, ingreso-de-consola.ts): ni apps/web, ni apps/plataforma (que entra por esas dos), ni el resto de src/ (R10).",
    from: {
      path: "^(src|apps)/",
      pathNot:
        "^src/composicion/(plataforma|entorno-de-plataforma|puerta-de-consola|ingreso-de-consola)\\.ts$|\\.test\\.(ts|tsx)$",
    },
    to: { path: "^src/composicion/(plataforma|entorno-de-plataforma)\\.ts$" },
  },
  {
    // P8b (h5-p8 §2.4 bis). Previene: que cualquier parte de `src/` o de `apps/web` obtenga la puerta de la consola
    // (la que ejecuta casos de plataforma a partir de una sesión) y con ella la credencial de plataforma. Solo la
    // importa el servidor de la consola, que es quien tiene sesión de plataforma. Chequeo: las violaciones inyectadas
    // de reglas.test.ts.
    name: "puerta-de-consola-solo-desde-la-consola",
    severity: "error",
    comment:
      "src/composicion/puerta-de-consola.ts (ejecutar casos de plataforma desde una sesión) solo la importan apps/plataforma/servidor/ y las pruebas: ni apps/web ni el resto de src/ (R10).",
    from: {
      path: "^(src|apps)/",
      pathNot:
        "^apps/plataforma/servidor/|^src/composicion/(puerta-de-consola|ingreso-de-consola)\\.ts$|\\.test\\.(ts|tsx)$",
    },
    to: { path: "^src/composicion/puerta-de-consola\\.ts$" },
  },
  {
    // P8c (h5-p8 §7). Previene: que `apps/web` o cualquier parte de `src/` arme el ingreso de la consola y con él obtenga
    // el secreto de ingreso y el cliente de Google de la consola, las cadenas del rol de plataforma y del de
    // autenticación y la puerta que ejecuta casos de plataforma (R10). Solo lo importa el servidor de la consola.
    // Chequeo: las violaciones inyectadas de reglas.test.ts.
    name: "ingreso-de-consola-solo-desde-la-consola",
    severity: "error",
    comment:
      "src/composicion/ingreso-de-consola.ts (el ingreso de la consola armado: Google de la consola, secreto, personal habilitado y puerta) solo lo importan apps/plataforma/servidor/ y las pruebas: ni apps/web ni el resto de src/ (R10).",
    from: {
      path: "^(src|apps)/",
      pathNot:
        "^apps/plataforma/servidor/|^src/composicion/ingreso-de-consola\\.ts$|\\.test\\.(ts|tsx)$",
    },
    to: { path: "^src/composicion/ingreso-de-consola\\.ts$" },
  },
  {
    // Consola de plataforma (UX1 §4, decisión del 2026-10-20). La consola reutiliza la interfaz de `apps/web/ui`
    // (primitivas, componentes, patrones, plantillas y tokens) y nada más de la web: ni sus pantallas, ni su servidor,
    // ni sus rutas. Previene: que la consola herede el código de empresa (sesión, marcas, cookies `pd_emp`). El sentido
    // inverso (la web importando la consola) lo cubre `apps-independientes`, que sigue valiendo para todo `apps/web`.
    // Chequeo: las violaciones inyectadas de reglas.test.ts.
    name: "plataforma-solo-importa-la-interfaz-de-la-web",
    severity: "error",
    comment:
      "apps/plataforma importa de apps/web solo apps/web/ui/ (la interfaz compartida); nunca sus pantallas, su servidor ni sus rutas.",
    from: { path: "^apps/plataforma/" },
    to: { path: "^apps/", pathNot: "^apps/(plataforma/|web/ui/)" },
  },
];
