import type { ClaveAccion } from "../modulos/catalogo";
import type { IdDeDato } from "./registro";

/**
 * CAMINOS DECLARADOS (regla 5.b de `Pedernal-docs/01-vision/primitivas-de-negocio.md`, dueño 05/11/2026; D1 del estudio `generacion-de-pantallas-estudio.md`, piloto
 * «B + D1», 12/11/2026): cada pantalla con formulario declara su función, la acción que ejecuta y qué dato completa cada paso. Es un VERIFICADOR, no un generador: no
 * arma nada, solo permite que `test/arquitectura/caminos-declarados.test.ts` falle cuando lo declarado no cuadra.
 *
 * Previene el fallo que originó la regla: al emitir, el aviso decía «nombre, documento, condición frente al IVA o domicilio» sin marcar cuál y la pantalla no tenía
 * campo de domicilio (nada garantizaba que los pasos cubrieran lo que la acción requiere). Chequeos (cada uno con su violación inyectada en
 * `test/arquitectura/caminos-declarados-evasiones.test.ts`):
 *  (a) un dato que la acción EXIGE y ningún paso completa (ni se deriva solo) falla;
 *  (b) un dato que un paso pide y la acción no consume (ni exige ni admite) falla;
 *  (c) un `campo` que el servidor puede devolver en un error y no existe en ningún paso falla.
 * Y la forma: todo dato existe en el registro, la acción existe en el catálogo, la pantalla existe y la pide (`consumidores` del dato). Lo que no se declara no se
 * verifica (por eso los caminos de las demás pantallas se suman cada uno con su pantalla: la limpieza del registro va con cada pantalla nueva, no aparte).
 */

export type PasoDeCamino = Readonly<{
  id: string;
  /** El nombre de cada campo del pedido que este paso pide y el dato del registro que completa. */
  campos: Readonly<Record<string, IdDeDato>>;
}>;

export type DefinicionDeCamino = Readonly<{
  /** Qué hace la persona con la pantalla. */
  funcion: string;
  /** Las pantallas (archivos desde la raíz) donde se recorre el camino. */
  pantallas: readonly [string, ...string[]];
  pasos: readonly [PasoDeCamino, ...PasoDeCamino[]];
  /** Lo que la acción recibe sin que ningún paso lo pida (por ejemplo, una letra que se calcula): cubre lo que la acción exige. */
  deriva: readonly IdDeDato[];
  accion: Readonly<{
    clave: ClaveAccion;
    /** Los datos sin los cuales la acción no se puede ejecutar. */
    requiere: readonly IdDeDato[];
    /** Los datos opcionales que la acción acepta. */
    admite: readonly IdDeDato[];
  }>;
  /** Los `campo` que el servidor puede devolver en un error de esta acción (nombres de campo del pedido). */
  camposDeError: readonly string[];
}>;

const FORMULARIO_DE_MEDIO = "apps/web/ui/plantillas/caja/FormularioDeMedio.cliente.tsx";
const FORMULARIO_DE_CUENTA = "apps/web/ui/plantillas/caja/FormularioDeCuenta.cliente.tsx";
const FORMULARIO_DE_CAJA = "apps/web/ui/plantillas/caja/FormularioDeCaja.cliente.tsx";

const LISTA_DE_PRODUCTOS =
  "apps/web/ui/plantillas/catalogo/FormularioDeFiltrosDeProductos.cliente.tsx";

const FORMULARIO_DE_FICHA_DE_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente.tsx";

const FORMULARIO_DE_ALTA_DE_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/FormularioDeAltaDeProducto.cliente.tsx";

export const CAMINOS = {
  // Productos, lista: buscar por nombre y filtrar por clase y por estado. Es una lectura: la acción es la que deja mirar (`productos.ver`) y ningún dato es obligatorio (todo vacío es «todos»).
  // Sin `campo` de error: un filtro que no puede coincidir devuelve la lista vacía, no un error (`entradas-de-productos.ts`).
  "buscar-productos": {
    funcion: "Buscar productos de la empresa por nombre, clase y estado",
    pantallas: [LISTA_DE_PRODUCTOS],
    pasos: [
      {
        id: "filtros-de-la-lista",
        campos: {
          texto: "texto-de-busqueda-de-producto",
          clase: "clase-de-uso-de-producto",
          estado: "estado-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.ver",
      requiere: [],
      admite: ["texto-de-busqueda-de-producto", "clase-de-uso-de-producto", "estado-de-producto"],
    },
    camposDeError: [],
  },
  // Productos, ficha de datos: el nombre es el único dato obligatorio para todas las clases; el nombre de cocina, la alícuota (obligatoria si se vende, lo decide el servidor) y la
  // sección son de las clases que se venden. La descripción de la carta no se pide acá (la maqueta no la trae) y se conserva. Los errores con campo son los cuatro que la maqueta
  // `productos.html` redacta para la ficha: nombre repetido o vacío, código repetido, código de barras inválido y alícuota sin elegir.
  "guardar-ficha-de-producto": {
    funcion: "Guardar los datos de un producto de la empresa",
    pantallas: [FORMULARIO_DE_FICHA_DE_PRODUCTO],
    pasos: [
      {
        id: "datos-del-producto",
        campos: {
          nombre: "nombre-de-producto",
          nombreDeCocina: "nombre-de-cocina-de-producto",
          codigo: "codigo-interno-de-producto",
          codigoDeBarras: "codigo-de-barras-de-producto",
          alicuota: "alicuota-de-iva-de-producto",
          seccionDeCartaId: "seccion-de-carta-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.editar",
      requiere: ["nombre-de-producto"],
      admite: [
        "nombre-de-cocina-de-producto",
        "codigo-interno-de-producto",
        "codigo-de-barras-de-producto",
        "alicuota-de-iva-de-producto",
        "seccion-de-carta-de-producto",
      ],
    },
    camposDeError: ["nombre", "codigo", "codigoDeBarras", "alicuota"],
  },
  // Productos, alta: la clase, la unidad y el nombre son obligatorios para todas las clases; el nombre de cocina, la alícuota (obligatoria si se vende, lo decide el servidor) y la sección
  // son de las clases que se venden. La clase y la unidad no se cambian después (dueño, 12/11 y 13/11/2026). Los errores con campo son los que la maqueta `productos.html` redacta: nombre
  // repetido o vacío, código repetido, código de barras inválido y alícuota sin elegir. «Se controla el stock» no se pide: nace sin tildar y el catálogo no lo guarda.
  "crear-producto": {
    funcion: "Crear un producto de la empresa",
    pantallas: [FORMULARIO_DE_ALTA_DE_PRODUCTO],
    pasos: [
      {
        id: "datos-del-producto-nuevo",
        campos: {
          claseDeUso: "clase-de-uso-de-producto",
          nombre: "nombre-de-producto",
          nombreDeCocina: "nombre-de-cocina-de-producto",
          codigo: "codigo-interno-de-producto",
          codigoDeBarras: "codigo-de-barras-de-producto",
          unidadBaseId: "unidad-de-medida-de-producto",
          alicuota: "alicuota-de-iva-de-producto",
          seccionDeCartaId: "seccion-de-carta-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.crear",
      requiere: ["clase-de-uso-de-producto", "nombre-de-producto", "unidad-de-medida-de-producto"],
      admite: [
        "nombre-de-cocina-de-producto",
        "codigo-interno-de-producto",
        "codigo-de-barras-de-producto",
        "alicuota-de-iva-de-producto",
        "seccion-de-carta-de-producto",
      ],
    },
    camposDeError: ["nombre", "codigo", "codigoDeBarras", "alicuota"],
  },
  // Medios de pago, alta: el tipo es obligatorio (lista cerrada) y el nombre es opcional. Sin `campo` de error: los rechazos de esta pantalla son el aviso genérico y el del nombre
  // repetido, que no apuntan a un campo (maqueta `medios.html`, 09/11/2026).
  "agregar-medio-de-pago": {
    funcion: "Agregar un medio de pago de la empresa",
    pantallas: [FORMULARIO_DE_MEDIO],
    pasos: [
      {
        id: "datos-del-medio",
        campos: { tipo: "tipo-de-medio-de-pago", nombre: "nombre-de-medio-de-pago" },
      },
    ],
    deriva: [],
    accion: {
      clave: "medios_de_pago.crear",
      requiere: ["tipo-de-medio-de-pago"],
      admite: ["nombre-de-medio-de-pago"],
    },
    camposDeError: [],
  },
  // Medios de pago, edición: solo el nombre (el tipo no se cambia; en pantalla sale apagado y no viaja).
  "editar-medio-de-pago": {
    funcion: "Cambiar el nombre de un medio de pago",
    pantallas: [FORMULARIO_DE_MEDIO],
    pasos: [{ id: "nombre-del-medio", campos: { nombre: "nombre-de-medio-de-pago" } }],
    deriva: [],
    accion: { clave: "medios_de_pago.editar", requiere: [], admite: ["nombre-de-medio-de-pago"] },
    camposDeError: [],
  },
  // Cuentas de cobro, alta: el tipo, el nombre y la sucursal son obligatorios; el identificador es opcional. Los rechazos que apuntan a un campo: el identificador con forma de credencial.
  "agregar-cuenta-de-cobro": {
    funcion: "Agregar una cuenta de cobro (terminal, QR o cuenta bancaria) de una sucursal",
    pantallas: [FORMULARIO_DE_CUENTA],
    pasos: [
      {
        id: "datos-de-la-cuenta",
        campos: {
          nombre: "nombre-de-cuenta-de-cobro",
          tipo: "tipo-de-cuenta-de-cobro",
          identificadorExterno: "identificador-de-cuenta-de-cobro",
          sucursalId: "sucursal-de-cuenta-de-cobro",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "cuentas_de_cobro.crear",
      requiere: [
        "nombre-de-cuenta-de-cobro",
        "tipo-de-cuenta-de-cobro",
        "sucursal-de-cuenta-de-cobro",
      ],
      admite: ["identificador-de-cuenta-de-cobro"],
    },
    camposDeError: [],
  },
  // Cuentas de cobro, edición: nombre, identificador y sucursal (el tipo no se cambia; en pantalla sale apagado y no viaja).
  "editar-cuenta-de-cobro": {
    funcion: "Cambiar el nombre, el identificador o la sucursal de una cuenta de cobro",
    pantallas: [FORMULARIO_DE_CUENTA],
    pasos: [
      {
        id: "datos-de-la-cuenta",
        campos: {
          nombre: "nombre-de-cuenta-de-cobro",
          identificadorExterno: "identificador-de-cuenta-de-cobro",
          sucursalId: "sucursal-de-cuenta-de-cobro",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "cuentas_de_cobro.editar",
      requiere: ["nombre-de-cuenta-de-cobro", "sucursal-de-cuenta-de-cobro"],
      admite: ["identificador-de-cuenta-de-cobro"],
    },
    camposDeError: [],
  },
  // Cajas, alta y edición: solo el nombre. La sucursal de una caja nueva la fija el servidor (la elegida en el dispositivo): no es un dato que ningún paso pida.
  "agregar-caja": {
    funcion: "Agregar una caja a la sucursal elegida",
    pantallas: [FORMULARIO_DE_CAJA],
    pasos: [{ id: "nombre-de-la-caja", campos: { nombre: "nombre-de-caja" } }],
    deriva: [],
    accion: { clave: "cajas.crear", requiere: ["nombre-de-caja"], admite: [] },
    camposDeError: [],
  },
  "editar-caja": {
    funcion: "Cambiar el nombre de una caja",
    pantallas: [FORMULARIO_DE_CAJA],
    pasos: [{ id: "nombre-de-la-caja", campos: { nombre: "nombre-de-caja" } }],
    deriva: [],
    accion: { clave: "cajas.editar", requiere: ["nombre-de-caja"], admite: [] },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;

export type IdDeCamino = keyof typeof CAMINOS;
