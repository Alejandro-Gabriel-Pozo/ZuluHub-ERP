import type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * Los datos de la configuración fiscal del registro de datos (ver `registro.ts`), en su propio archivo (un fragmento por módulo/pantalla) para que dos ramas
 * que suman datos de pantallas distintas no toquen las mismas líneas. Un dato no puede estar en dos fragmentos (`test/arquitectura/datos-por-modulo.test.ts`).
 *
 * `ponerPor` y `requiere` salen del caso de uso que guarda estos datos: `guardarBorradorDeDatosFiscales` exige `datos_fiscales.editar`, acción del módulo
 * `administracion` (`src/capacidades/modulos/catalogo.ts`). `estadoDeEmpresa` es solo `ACTIVE` (supuesto DEC-0062, lo más cerrado).
 */

const REQUIERE_ADMINISTRACION = { modulo: "administracion", estadoDeEmpresa: ["ACTIVE"] } as const;
const CONSUMIDOR_DE_DATOS_FISCALES =
  "apps/web/ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente.tsx";

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
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "numero-de-calle-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Número del domicilio fiscal del emisor (hasta seis dígitos o `S/N`).",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (domicilios y provincias)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
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
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
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
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "localidad-de-domicilio": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [
      {
        para: "Localidad del domicilio fiscal del emisor.",
        fuente: "Pedernal-docs/11-especificaciones/h7-fiscal.md §B.4 (domicilios y provincias)",
      },
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
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
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
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
    ],
    consumidores: [CONSUMIDOR_DE_DATOS_FISCALES],
    ponerPor: ["datos_fiscales.editar"],
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
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
