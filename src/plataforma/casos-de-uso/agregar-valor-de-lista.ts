import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  listaDesdeTexto,
  nombreDeValorDesdeTexto,
  traducirErroresDeListas,
  type ErrorDeListaInvalida,
  type ErrorDeNombreDeValor,
  type ListaDelSistema,
} from "../../modulos/listas/publico";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  datosDelValorDeLista,
  ejecutarCasoDeListas,
  ENTIDAD_VALOR_DE_LISTA,
  type DependenciasDeListas,
  type ErrorComunDeListas,
} from "./listas-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_AGREGAR_VALOR_DE_LISTA = "listas.agregar_valor";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_AGREGAR_VALOR_DE_LISTA = {
  accion: "listas.editar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeAgregarValorDeLista = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN agregar otra vez ni auditar de nuevo. */
  claveDeIdempotencia: string;
  /** `MARCAS_DE_TARJETA` o `MOTIVOS_DE_RECHAZO`; llega sin tipar y se valida contra las listas declaradas. */
  lista: string;
  nombre: string;
}>;

export type SalidaDeAgregarValorDeLista = Readonly<{
  valorId: string;
  /** La versión con la que nace: la `versionEsperada` del primer cambio. */
  version: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = ["VALOR_DUPLICADO"] as const;

export type ErrorAlAgregarValorDeLista =
  | ErrorComunDeListas
  | ErrorDeListaInvalida
  | ErrorDeNombreDeValor
  | (typeof MOTIVOS_QUE_ADMITE)[number];

type Pedido = Readonly<{ lista: ListaDelSistema; nombre: string }>;

/**
 * Agregar un valor a una lista del sistema (e3 §3.7). Contexto de PLATAFORMA, solo ADMIN (`listas.editar`). El nombre es único por lista
 * SIN distinguir mayúsculas ni acentos: agregar uno que ya está es `VALOR_DUPLICADO`, también si se lo agrega dos veces seguidas con
 * claves distintas o si dos personas lo agregan a la vez (queda uno; el segundo recibe `VALOR_DUPLICADO`). Con la MISMA clave, repetir
 * devuelve lo del primero. El valor nace activo y no fijo. Deja la constancia `VALOR_DE_LISTA_AGREGADO`.
 */
export function armarAgregarValorDeLista(dependencias: DependenciasDeListas) {
  return async function agregarValorDeLista(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeAgregarValorDeLista,
  ): Promise<Resultado<SalidaDeAgregarValorDeLista, ErrorAlAgregarValorDeLista>> {
    const resultado = await ejecutarCasoDeListas<
      SalidaDeAgregarValorDeLista,
      Pedido,
      ErrorDeListaInvalida | ErrorDeNombreDeValor | "VALOR_DUPLICADO"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_AGREGAR_VALOR_DE_LISTA.accion,
      operacion: OPERACION_AGREGAR_VALOR_DE_LISTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const lista = listaDesdeTexto(entrada.lista);
        if (!lista.ok) return lista;
        const nombre = nombreDeValorDesdeTexto(entrada.nombre);
        if (!nombre.ok) return nombre;
        // La huella lleva lo ya validado y en forma canónica: el mismo pedido escrito distinto es el mismo pedido.
        return ok({
          entrada: { lista: lista.valor, nombre: nombre.valor },
          valor: { lista: lista.valor, nombre: nombre.valor },
        });
      },
      trabajar: async (tx, pedido) => {
        if ((await tx.listas.porNombre(pedido.lista, pedido.nombre)) !== null) {
          return err("VALOR_DUPLICADO");
        }
        const nuevo = await tx.listas.agregar(pedido.lista, pedido.nombre);
        if (nuevo === null) {
          // Otra transacción lo agregó entre la lectura y la escritura (`ON CONFLICT DO NOTHING` no lanza): se relee. Si tampoco se
          // ve, la foto de esta transacción es vieja y se pide repetir.
          return (await tx.listas.porNombre(pedido.lista, pedido.nombre)) === null
            ? err({ tipo: "ConcurrenciaAgotada" })
            : err("VALOR_DUPLICADO");
        }
        return ok({
          salida: { valorId: nuevo.id, version: nuevo.version },
          constancias: [
            {
              accion: "VALOR_DE_LISTA_AGREGADO",
              entidad: ENTIDAD_VALOR_DE_LISTA,
              entidadId: nuevo.id,
              antes: null,
              despues: datosDelValorDeLista(nuevo),
            },
          ],
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return traducirErroresDeListas(resultado, MOTIVOS_QUE_ADMITE);
  };
}
