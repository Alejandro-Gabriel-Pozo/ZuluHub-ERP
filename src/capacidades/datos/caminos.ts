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

export const CAMINOS = {
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
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;

export type IdDeCamino = keyof typeof CAMINOS;
