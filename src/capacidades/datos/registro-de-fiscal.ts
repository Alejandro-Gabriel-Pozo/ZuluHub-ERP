import type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * Los datos de la configuración fiscal del registro de datos (ver `registro.ts`), en su propio archivo (un fragmento por módulo/pantalla) para que dos ramas
 * que suman datos de pantallas distintas no toquen las mismas líneas. Un dato no puede estar en dos fragmentos (`test/arquitectura/datos-por-modulo.test.ts`).
 *
 * `ponerPor` y `requiere` salen del caso de uso que guarda cada dato: datos fiscales y puntos de venta exigen `datos_fiscales.editar` y `puntos_de_venta.*`, acciones del módulo
 * `administracion`; el pedido de certificado exige `certificados.gestionar`, del módulo `facturacion` (`src/capacidades/modulos/catalogo.ts`). `estadoDeEmpresa` es solo `ACTIVE` (supuesto DEC-0062, lo más cerrado).
 */

const REQUIERE_ADMINISTRACION = { modulo: "administracion", estadoDeEmpresa: ["ACTIVE"] } as const;
const REQUIERE_FACTURACION = { modulo: "facturacion", estadoDeEmpresa: ["ACTIVE"] } as const;
const CONSUMIDOR_DE_DATOS_FISCALES =
  "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx";
const CONSUMIDOR_DE_PUNTO_DE_VENTA =
  "apps/web/ui/plantillas/configuracion-fiscal/FormularioDePuntoDeVenta.cliente.tsx";
const CONSUMIDOR_DE_PEDIDO_DE_CERTIFICADO =
  "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx";

export const DATOS_DE_FISCAL = {
  "razon-social-del-emisor": {
    ficha: "src/primitivas/texto/nombre-o-razon-social.ts",
    propositos: [
      {
        para: "Razón social fiscal del emisor, que edita el gerente dentro de los datos fiscales (obligatoria para confirmar).",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`razon_social`) y §F.1",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "condicion-iva-del-emisor": {
    ficha: "src/primitivas/identificacion-fiscal/condicion-iva.ts",
    propositos: [
      {
        para: "Condición frente al IVA del emisor en sus datos fiscales (obligatoria para confirmar).",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`condicion_iva`)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "calle-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Calle del domicilio fiscal del emisor.",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`domicilio_fiscal_id`) y §B.4",
      },
      {
        para: "Calle del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "numero-de-calle-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Número del domicilio fiscal del emisor (hasta seis dígitos o `S/N`).",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (domicilios y provincias)",
      },
      {
        para: "Número del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "piso-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Piso del domicilio fiscal del emisor (opcional).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (piso, departamento y CP opcionales)",
      },
      {
        para: "Piso del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "departamento-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Departamento del domicilio fiscal del emisor (opcional).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (piso, departamento y CP opcionales)",
      },
      {
        para: "Departamento del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "localidad-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Localidad del domicilio fiscal del emisor.",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (domicilios y provincias)",
      },
      {
        para: "Localidad del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "provincia-de-domicilio": {
    ficha: "src/primitivas/domicilio/provincias.ts",
    propositos: [
      {
        para: "Provincia del domicilio fiscal del emisor, elegida del catálogo de 24 jurisdicciones.",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (`provincia`: catálogo global)",
      },
      {
        para: "Provincia del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "codigo-postal-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Código postal del domicilio fiscal del emisor (opcional).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (formato del CP NO VERIFICADO: alfanumérico de 4 a 8)",
      },
      {
        para: "Código postal del domicilio del punto de venta (para el comprobante).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (el punto de venta puede cambiar de domicilio) y §B.4",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES, CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["datos_fiscales.editar", "puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "condicion-de-ingresos-brutos": {
    ficha: "src/primitivas/identificacion-fiscal/ingresos-brutos.ts",
    propositos: [
      {
        para: "Cómo se declara Ingresos Brutos en los datos fiscales del emisor: con número de inscripción o como «No contribuyente».",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`iibb_condicion`) y D-115/D-116 (RG 1415 Anexo II A.I.a punto 4)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "numero-de-ingresos-brutos": {
    ficha: "src/primitivas/identificacion-fiscal/ingresos-brutos.ts",
    propositos: [
      {
        para: "Número de inscripción en Ingresos Brutos del emisor (cuando no es «No contribuyente»).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`iibb_numero`) y D-115/D-116 (RG 1415 Anexo II A.I.a punto 4)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "inicio-de-actividades": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      {
        para: "Fecha de inicio de actividades del emisor, fecha civil aaaa-mm-dd (obligatoria para confirmar).",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.3 (`inicio_actividades`)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "numero-de-punto-de-venta": {
    ficha: "src/primitivas/identificacion-fiscal/numero-de-punto-de-venta.ts",
    propositos: [
      {
        para: "Número del punto de venta de un emisor (de 1 a 99999; rango NO VERIFICADO).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (punto de venta: «Número entre 1 y 99999»)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "alias-de-certificado": {
    ficha: "src/primitivas/identificacion-fiscal/alias-de-certificado.ts",
    propositos: [
      {
        para: "Alias con el que se identifica el certificado de ARCA que se pide (no se puede repetir).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.9 (pedido de certificado, `CN=<alias del sistema>`)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_PEDIDO_DE_CERTIFICADO],
    ponerPor: ["certificados.gestionar"],
    requiere: REQUIERE_FACTURACION,
  },
  "cuit-del-titular-de-certificado": {
    ficha: "src/primitivas/identificacion-fiscal/cuit.ts",
    propositos: [
      {
        para: "CUIT de la persona física titular del certificado de ARCA (no tiene por qué ser el del emisor).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.9 (`cuit_titular`, `serialNumber=CUIT nnnnnnnnnnn`)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_PEDIDO_DE_CERTIFICADO],
    ponerPor: ["certificados.gestionar"],
    requiere: REQUIERE_FACTURACION,
  },
  "sucursal-de-punto-de-venta": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [
      {
        para: "Sucursal a la que pertenece el punto de venta (se elige de la lista de sucursales de la empresa; el servidor valida que sea de la misma empresa).",
        fuente:
          "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.5 (punto de venta: «Pertenece a un emisor y a una sucursal de la misma empresa»)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_PUNTO_DE_VENTA],
    ponerPor: ["puntos_de_venta.crear", "puntos_de_venta.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
