import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirNuevoNombre,
  nombreDeValorDesdeTexto,
  traducirErroresDeListas,
  type ErrorDeCambioDeValor,
  type ErrorDeNombreDeValor,
} from "../../modulos/listas/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarVersionVista } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  datosDelValorDeLista,
  ejecutarCasoDeListas,
  ENTIDAD_VALOR_DE_LISTA,
  type DependenciasDeListas,
  type ErrorComunDeListas,
} from "./listas-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_CORREGIR_NOMBRE_DE_VALOR = "listas.corregir_nombre";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_CORREGIR_NOMBRE_DE_VALOR = {
  accion: "listas.editar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeCorregirNombreDeValor = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN escribir ni auditar de nuevo. */
  claveDeIdempotencia: string;
  valorId: string;
  nombre: string;
  /** La `version` del valor que vio quien corrige. Si otra persona lo cambió entretanto, `VERSION_DESACTUALIZADA`. */
  versionEsperada: number;
}>;

export type SalidaDeCorregirNombreDeValor = Readonly<{
  /** La versión del valor después del pedido: la `versionEsperada` del próximo cambio. */
  version: number;
  /** `true` cuando esta llamada no escribió nada: el nombre ya era ese, o repite una anterior con la misma clave. */
  sinCambios: boolean;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = ["VALOR_DUPLICADO", "VALOR_FIJO"] as const;

type ErrorPropio =
  | ErrorDeNombreDeValor
  | ErrorDeCambioDeValor
  | "ID_INVALIDO"
  | "VERSION_ESPERADA_INVALIDA"
  | "VALOR_NO_ENCONTRADO"
  | "VALOR_DUPLICADO";

export type ErrorAlCorregirNombreDeValor =
  ErrorComunDeListas | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number];

type Pedido = Readonly<{ valorId: string; nombre: string; versionEsperada: number }>;

/**
 * Corregir el nombre de un valor de una lista del sistema (e3 §3.7). Contexto de PLATAFORMA, solo ADMIN (`listas.editar`). El cambio se
 * ve también en lo ya cobrado: los cobros guardan el id del valor, no el texto. Con otra `versionEsperada` es `VERSION_DESACTUALIZADA`
 * (dos personas que corrigen desde la misma versión: una gana y la otra lo ve). El nombre de otro valor de la lista, sin distinguir
 * mayúsculas ni acentos, es `VALOR_DUPLICADO`; el de este mismo valor con otras mayúsculas o acentos, un cambio válido. Un valor fijo
 * («Otra») no se renombra (`VALOR_FIJO`). El mismo nombre, tal cual, es éxito sin escribir ni auditar. Deja la constancia
 * `VALOR_DE_LISTA_RENOMBRADO` con el valor de antes y el de después.
 */
export function armarCorregirNombreDeValor(dependencias: DependenciasDeListas) {
  return async function corregirNombreDeValor(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCorregirNombreDeValor,
  ): Promise<Resultado<SalidaDeCorregirNombreDeValor, ErrorAlCorregirNombreDeValor>> {
    const resultado = await ejecutarCasoDeListas<
      SalidaDeCorregirNombreDeValor,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_CORREGIR_NOMBRE_DE_VALOR.accion,
      operacion: OPERACION_CORREGIR_NOMBRE_DE_VALOR,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const valor = uuidDesdeTexto(entrada.valorId);
        if (!valor.ok) return valor;
        const nombre = nombreDeValorDesdeTexto(entrada.nombre);
        if (!nombre.ok) return nombre;
        const version = validarVersionVista(entrada.versionEsperada);
        if (!version.ok) return version;
        const pedido = {
          valorId: valor.valor,
          nombre: nombre.valor,
          versionEsperada: version.valor,
        };
        return ok({ entrada: pedido, valor: pedido });
      },
      trabajar: async (tx, pedido) => {
        const actual = await tx.listas.porId(pedido.valorId);
        if (actual === null) return err("VALOR_NO_ENCONTRADO");
        const decision = decidirNuevoNombre(actual, pedido.nombre, pedido.versionEsperada);
        if (!decision.ok) return decision;
        if (!decision.valor.cambia) {
          return ok({ salida: { version: actual.version, sinCambios: true }, constancias: [] });
        }
        // Otro valor de la lista con ese nombre (sin distinguir mayúsculas ni acentos): el de ESTE mismo valor es un cambio válido.
        const igual = await tx.listas.porNombre(actual.lista, pedido.nombre);
        if (igual !== null && igual.id !== actual.id) return err("VALOR_DUPLICADO");
        const nuevo = await tx.listas.cambiar(actual.id, actual.version, { nombre: pedido.nombre });
        // Con SERIALIZABLE otra transacción que cambiara el valor antes ya habría abortado ésta (40001, que el adaptador reintenta):
        // sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (nuevo === null) return err({ tipo: "ConcurrenciaAgotada" });
        return ok({
          salida: { version: nuevo.version, sinCambios: false },
          constancias: [
            {
              accion: "VALOR_DE_LISTA_RENOMBRADO",
              entidad: ENTIDAD_VALOR_DE_LISTA,
              entidadId: nuevo.id,
              antes: datosDelValorDeLista(actual),
              despues: datosDelValorDeLista(nuevo),
            },
          ],
        });
      },
      comoRepeticion: (guardado) => ({ version: guardado.version, sinCambios: true }),
    });
    return traducirErroresDeListas(resultado, MOTIVOS_QUE_ADMITE);
  };
}
