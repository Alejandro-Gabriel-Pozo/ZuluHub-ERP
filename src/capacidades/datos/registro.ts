import type { EstadoDeEmpresa } from "../../contexto/estados";
import type { ClaveAccion, ClaveModulo } from "../modulos/catalogo";

/**
 * REGISTRO DE DATOS (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; dueño, 2026-11-05: «sin declaración de
 * existencia debería fallar»). Todo campo de entrada de la web y de la consola dice qué dato pide con la prop `dato`, y ese dato
 * tiene que estar acá, con su primitiva (ficha), para qué existe, dónde se pide, quién lo pone y qué necesita para existir.
 *
 * Previene: el fallo real que lo originó. La primitiva del CUIT existía y el campo de documento de «Emitir» no la usaba; el
 * nombre aceptó solo números y el CUIT quedó escrito como nombre. El chequeo mecánico es
 * `test/arquitectura/campos-con-dato.test.ts` (control crudo, campo sin dato, dato no registrado, consumidor no declarado y dato
 * huérfano fallan; cada uno con su violación inyectada).
 *
 * Todo nace cerrado: un dato nuevo se agrega acá, con consumidor real; lo que todavía no está declarado usa `DATO_PENDIENTE` y es
 * deuda registrada con vencimiento en `arquitectura/deuda/registro.json` (entradas `campos-sin-dato--*`), nunca una excepción
 * silenciosa. Solo se registran datos cuya primitiva ya está en `main` y que tienen al menos una pantalla real que los pide.
 *
 * SUPUESTO (a confirmar por el dueño): `estadoDeEmpresa` es solo `ACTIVE` (lo más cerrado); `ponerPor` de un filtro de lectura es la
 * acción que permite mirar.
 */

/** Marca de un campo cuyo dato todavía no está registrado: es deuda, la cuenta y la limita el chequeo. */
export const DATO_PENDIENTE = "pendiente" as const;

type Proposito = Readonly<{
  /** Para qué existe: una pantalla o un caso de uso reales. */
  para: string;
  /** Documento verificable (archivo y sección) donde el dueño o el diseño lo pidió. */
  fuente: string;
}>;

export type DefinicionDeDato = Readonly<{
  /** Ruta de la primitiva (la «ficha del dato»), desde la raíz del repositorio. */
  ficha: string;
  propositos: readonly [Proposito, ...Proposito[]];
  /** Archivos de pantalla (desde la raíz) que pueden pedir este dato. Uno que lo pide y no figura acá falla; uno que figura y no lo pide también. */
  consumidores: readonly [string, ...string[]];
  /** Acciones de permiso que habilitan a ponerlo. */
  ponerPor: readonly [ClaveAccion, ...ClaveAccion[]];
  requiere: Readonly<{
    modulo: ClaveModulo;
    estadoDeEmpresa: readonly [EstadoDeEmpresa, ...EstadoDeEmpresa[]];
  }>;
}>;

const CONTACTO = "apps/web/ui/plantillas/sesion/PantallaDeContactoDeLaSucursal.cliente.tsx";
const CONTACTO_PROPOSITO: Proposito = {
  para: "Contacto de la sucursal que la factura impresa muestra (pantalla de contacto de la sucursal).",
  fuente:
    "Pedernal-docs/11-especificaciones/diseno-contacto-de-la-sucursal.md §4 (casos de uso) y D-98",
};
const REQUIERE_ADMINISTRACION = {
  modulo: "administracion",
  estadoDeEmpresa: ["ACTIVE"],
} as const;
const REQUIERE_FACTURACION = { modulo: "facturacion", estadoDeEmpresa: ["ACTIVE"] } as const;

export const REGISTRO_DE_DATOS = {
  correo: {
    ficha: "src/primitivas/contacto/email.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  telefono: {
    ficha: "src/primitivas/contacto/telefono.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  web: {
    ficha: "src/primitivas/contacto/web.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "fecha-civil": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      {
        para: "Período personalizado (desde, hasta) del listado de comprobantes.",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 1: Listado de comprobantes»",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/FormularioDeFiltros.cliente.tsx"],
    ponerPor: ["comprobantes.ver"],
    requiere: REQUIERE_FACTURACION,
  },
  importe: {
    ficha: "src/primitivas/dinero/importe.ts",
    propositos: [
      {
        para: "Importe unitario de cada renglón al emitir una factura (importes como texto decimal).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 2, renglones)",
      },
      {
        para: "Importe a anular por alícuota en la anulación parcial (D-69).",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 2: Detalle de un comprobante» (anulación por importe) y registro de decisiones D-69",
      },
    ],
    consumidores: [
      "apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx",
      "apps/web/ui/plantillas/facturacion/PantallaDeAnularComprobante.cliente.tsx",
    ],
    ponerPor: ["comprobantes.emitir", "notas_de_credito.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  cantidad: {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      {
        para: "Cantidad de cada renglón al emitir una factura.",
        fuente:
          "Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 2, renglones)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "nombre-o-razon-social": {
    ficha: "src/primitivas/texto/nombre-o-razon-social.ts",
    propositos: [
      {
        para: "Nombre o razón social del cliente al emitir una factura (RG 1415 Anexo II A.II: se imprime en la factura).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "documento-de-identidad": {
    ficha: "src/primitivas/identificacion-fiscal/documento.ts",
    propositos: [
      {
        para: "Tipo y número de documento del cliente al emitir una factura (CUIT, CUIL, CDI, DNI o pasaporte; la clase A exige CUIT).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "domicilio-libre": {
    ficha: "src/primitivas/domicilio/domicilio-libre.ts",
    propositos: [
      {
        para: "Domicilio comercial del cliente al emitir una factura: obligatorio salvo consumidor final (RG 1415 Anexo II A.II).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
  "condicion-iva": {
    ficha: "src/primitivas/identificacion-fiscal/condicion-iva.ts",
    propositos: [
      {
        para: "Condición frente al IVA del cliente al emitir una factura (de ella sale la letra A, B o C).",
        fuente:
          "Pedernal-docs/11-especificaciones/emitir-plan-factura-a.md §1 (decisiones del dueño, 2026-11-06) y facturador-contratos-de-pantalla.md «Contrato de la pantalla 3: Emitir una factura» (paso 1, cliente)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/facturacion/PasosDeEmision.tsx"],
    ponerPor: ["comprobantes.emitir"],
    requiere: REQUIERE_FACTURACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;

export type IdDeDato = keyof typeof REGISTRO_DE_DATOS;

/** Lo que acepta la prop `dato` de un componente de campo. */
export type DatoDeCampo = IdDeDato | typeof DATO_PENDIENTE;

/**
 * Los únicos archivos que pueden tener un `<input>`, `<textarea>` o `<select>` crudo, y los únicos cuyo uso exige `dato`. Cada uno
 * tiene que declarar la prop `dato: DatoDeCampo` (lo comprueba el chequeo). Un componente de campo nuevo se suma acá.
 */
export const COMPONENTES_DE_CAMPO = [
  "apps/web/ui/componentes/Campo.tsx",
  "apps/web/ui/componentes/CampoDeCodigo.tsx",
  "apps/web/ui/componentes/CampoImporte.tsx",
  "apps/web/ui/componentes/Selector.tsx",
] as const;
