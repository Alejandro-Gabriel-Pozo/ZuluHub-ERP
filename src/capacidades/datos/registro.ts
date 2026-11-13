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
 * SUPUESTO (DEC-0062) (a confirmar por el dueño): `estadoDeEmpresa` es solo `ACTIVE` (lo más cerrado); `ponerPor` de un filtro de lectura es la
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
const REQUIERE_CAJA = { modulo: "caja", estadoDeEmpresa: ["ACTIVE"] } as const;
const MEDIOS_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeMedio.cliente.tsx";
const MEDIOS_PROPOSITO_NOMBRE: Proposito = {
  para: "Nombre propio, opcional, de un medio de pago al agregarlo o editarlo (pantalla «Medios de pago»).",
  fuente:
    "Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (medio de pago: el nombre es opcional, la pantalla usa el vocabulario del tipo) y la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
};
const CUENTA_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeCuenta.cliente.tsx";
const CAJA_FORMULARIO = "apps/web/ui/plantillas/caja/FormularioDeCaja.cliente.tsx";
const MAQUETA_DE_MEDIOS =
  "la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)";
const CUENTA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente: `Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (cuenta de cobro) y ${MAQUETA_DE_MEDIOS}`,
});
const CAJA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente: `Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (caja) y ${MAQUETA_DE_MEDIOS}`,
});
const MEDIOS_PROPOSITO_TIPO: Proposito = {
  para: "Tipo de un medio de pago, de una lista cerrada, al agregarlo (pantalla «Medios de pago»); no se cambia después.",
  fuente:
    "Pedernal-docs/11-especificaciones/caja-y-cobros.md §B.6 (medio de pago: lista cerrada de tipos) y la maqueta aprobada el 09/11/2026 (`medios.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
};

const FICHA_DE_PRODUCTO = "apps/web/ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente.tsx";
const REQUIERE_CATALOGO = { modulo: "catalogo", estadoDeEmpresa: ["ACTIVE"] } as const;
const FICHA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §5 (datos del producto y sus primitivas) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Datos», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});

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
  "nombre-de-medio-de-pago": {
    // SUPUESTO (DEC-0342): la ficha es el dominio de caja, que ya tiene el largo y el conjunto permitido del nombre del medio; no se movió a `primitivas/`
    // (cambio mayor que el de este tramo). Revertirlo es mover `nombreDeMedioValido` a una primitiva y apuntar esta ruta a ella.
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [MEDIOS_PROPOSITO_NOMBRE],
    consumidores: [MEDIOS_FORMULARIO],
    ponerPor: ["medios_de_pago.crear", "medios_de_pago.editar"],
    requiere: REQUIERE_CAJA,
  },
  "tipo-de-medio-de-pago": {
    ficha: "src/modulos/caja/estados.ts",
    propositos: [MEDIOS_PROPOSITO_TIPO],
    consumidores: [MEDIOS_FORMULARIO],
    ponerPor: ["medios_de_pago.crear"],
    requiere: REQUIERE_CAJA,
  },
  "nombre-de-cuenta-de-cobro": {
    // Misma ficha que el nombre del medio (SUPUESTO, DEC-0342): el dominio de caja tiene el largo y el conjunto permitido de cada nombre.
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Nombre de una cuenta de cobro al agregarla o editarla (pantalla «Cuentas de cobro»).",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "tipo-de-cuenta-de-cobro": {
    ficha: "src/modulos/caja/estados.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Tipo de una cuenta de cobro (terminal, QR o cuenta bancaria), de una lista cerrada, al agregarla; no se cambia después.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear"],
    requiere: REQUIERE_CAJA,
  },
  "identificador-de-cuenta-de-cobro": {
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Identificador opcional de una cuenta de cobro (número de terminal o alias, nunca una clave) al agregarla o editarla.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "sucursal-de-cuenta-de-cobro": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [
      CUENTA_PROPOSITO(
        "Sucursal a la que pertenece una cuenta de cobro: una sola, siempre elegida, al agregarla o editarla.",
      ),
    ],
    consumidores: [CUENTA_FORMULARIO],
    ponerPor: ["cuentas_de_cobro.crear", "cuentas_de_cobro.editar"],
    requiere: REQUIERE_CAJA,
  },
  "nombre-de-caja": {
    ficha: "src/modulos/caja/dominio/configuracion.ts",
    propositos: [
      CAJA_PROPOSITO(
        "Nombre de una caja de la sucursal al agregarla o editarla (pantalla «Cajas»).",
      ),
    ],
    consumidores: [CAJA_FORMULARIO],
    ponerPor: ["cajas.crear", "cajas.editar"],
    requiere: REQUIERE_CAJA,
  },
  "nombre-de-producto": {
    ficha: "src/primitivas/texto/nombre-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Nombre de un producto en su ficha de datos (obligatorio, único por empresa).",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-cocina-de-producto": {
    ficha: "src/primitivas/texto/nombre-de-cocina.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Nombre con el que la cocina ve un producto que se vende (reventa o producto vendible), en su ficha de datos; vacío: la cocina ve el nombre.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "codigo-interno-de-producto": {
    ficha: "src/primitivas/texto/codigo-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Código interno, opcional y único por empresa, de un producto en su ficha de datos.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "codigo-de-barras-de-producto": {
    ficha: "src/primitivas/texto/codigo-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Código de barras (de 8 a 14 dígitos), opcional, de un producto en su ficha de datos.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "alicuota-de-iva-de-producto": {
    // La lista que se ofrece (las seis de ARCA, sin «Exento» ni «No gravado») vive una vez, en `ALICUOTAS_DEL_PRODUCTO` del módulo fiscal.
    ficha: "src/modulos/fiscal/dominio/alicuota.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Alícuota de IVA de un producto que se vende, en su ficha de datos: una de las seis que ofrece el producto; es una decisión fiscal y no tiene valor por defecto.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "precio-de-venta-de-producto": {
    // El importe se tipea en pesos con dos decimales (`CampoImporte`) y viaja como texto decimal; la validez (sin signo, hasta 6 decimales, en rango) la decide esta primitiva dentro de `cambiarPrecio`.
    ficha: "src/primitivas/dinero/precio-de-venta.ts",
    propositos: [
      {
        para: "Precio de venta de la empresa de un producto, IVA incluido, en la solapa «Precios» de su ficha: se cambia agregando una fila al historial.",
        fuente:
          "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §2 (`cambiarPrecio`) y §5 (dinero en texto decimal, ADR-006) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Precios», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/catalogo/FormularioDePrecioDeProducto.cliente.tsx"],
    ponerPor: ["productos.cambiar_precio"],
    requiere: REQUIERE_CATALOGO,
  },
  "seccion-de-carta-de-producto": {
    // Una referencia a una sección activa de la carta de la empresa (no hay primitiva de texto: la fuente de las opciones es la consulta de secciones del catálogo).
    ficha: "src/modulos/catalogo/casos-de-uso/secciones.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Sección de la carta a la que pertenece un producto que se vende, en su ficha de datos: una de las secciones activas de la empresa, o ninguna.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
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
  "apps/web/ui/componentes/CampoDeDocumento.tsx",
  "apps/web/ui/componentes/CampoImporte.tsx",
  "apps/web/ui/componentes/CampoNumero.tsx",
  "apps/web/ui/componentes/Selector.tsx",
] as const;
