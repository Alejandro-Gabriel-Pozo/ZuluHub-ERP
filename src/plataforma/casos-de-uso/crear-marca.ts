import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirAltaDeMarca,
  traducirErroresDeMarca,
  validarCodigoDeMarca,
  type ErrorDeAltaDeMarca,
  type MarcaPorCrear,
} from "../../modulos/marcas/publico";
import { marcaComercialId, type MarcaComercialId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_CREAR_MARCA = "marcas.crear";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_CREAR_MARCA = {
  accion: "marcas.crear",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeCrearMarca = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN registrar otra marca ni otra constancia. */
  claveDeIdempotencia: string;
  /** El código técnico de la marca: minúsculas, dígitos y guion, de 2 a 40, empieza con letra. No cambia nunca. */
  codigo: string;
  /** La marca padre (en v1, la principal) o `null` para una marca sin padre. No cambia nunca. */
  marcaPadreId: string | null;
}>;

export type SalidaDeCrearMarca = Readonly<{
  marcaId: MarcaComercialId;
  /** `true` cuando la marca ya existía (mismo código y mismo padre) o esta llamada repite una anterior con la misma clave. */
  yaExistia: boolean;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "CODIGO_DE_MARCA_INVALIDO",
  "CODIGO_DE_MARCA_OCUPADO",
  "MARCA_PADRE_NO_ENCONTRADA",
  "MARCA_PADRE_RETIRADA",
  "NIVEL_DE_MARCA_NO_HABILITADO",
] as const;

type ErrorPropio =
  ErrorDeAltaDeMarca | "ID_INVALIDO" | "CODIGO_DE_MARCA_OCUPADO" | "MARCA_PADRE_NO_ENCONTRADA";

export type ErrorAlCrearMarca = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{ codigo: string; marcaPadreId: MarcaComercialId | null }>;

/**
 * Crear una marca (M5). Contexto de PLATAFORMA, solo ADMIN. Registra la marca con su código técnico y su
 * padre (en v1, la principal o ninguno); nace `ACTIVA` y sin versión confirmada: hasta que se confirme una
 * y se active un dominio, ningún host la resuelve. Crear la marca que ya existe (mismo código y mismo
 * padre) es éxito sin escribir (`yaExistia`); el mismo código con otro padre es `CODIGO_DE_MARCA_OCUPADO`.
 * Deja la constancia `MARCA_CREADA` con el actor del contexto. Dos altas del mismo código a la vez: una
 * gana y la otra ve la marca y devuelve `yaExistia` (o el motivo, si no coincide el padre).
 */
export function armarCrearMarca(dependencias: DependenciasDeMarcasYPlanes) {
  return async function crearMarca(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCrearMarca,
  ): Promise<Resultado<SalidaDeCrearMarca, ErrorAlCrearMarca>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<SalidaDeCrearMarca, Pedido, ErrorPropio>(
      dependencias,
      {
        contexto,
        accion: DECLARACION_DE_CREAR_MARCA.accion,
        operacion: OPERACION_CREAR_MARCA,
        claveDeIdempotencia: entrada.claveDeIdempotencia,
        validar: () => {
          const codigo = validarCodigoDeMarca(entrada.codigo);
          if (!codigo.ok) return codigo;
          let marcaPadreId: MarcaComercialId | null = null;
          if (entrada.marcaPadreId !== null) {
            const id = uuidDesdeTexto(entrada.marcaPadreId);
            if (!id.ok) return id;
            marcaPadreId = marcaComercialId(id.valor);
          }
          return ok({
            entrada: { codigo: codigo.valor, marcaPadreId },
            valor: { codigo: codigo.valor, marcaPadreId },
          });
        },
        trabajar: async (tx, pedido) => {
          const existente = await tx.marcas.obtenerPorCodigo(pedido.codigo);
          if (existente !== null) {
            if (existente.marcaPadreId !== pedido.marcaPadreId)
              return err("CODIGO_DE_MARCA_OCUPADO");
            return ok({ salida: { marcaId: existente.id, yaExistia: true }, constancia: null });
          }
          const padre =
            pedido.marcaPadreId === null ? null : await tx.marcas.obtener(pedido.marcaPadreId);
          if (pedido.marcaPadreId !== null && padre === null)
            return err("MARCA_PADRE_NO_ENCONTRADA");
          const alta: Resultado<MarcaPorCrear, ErrorDeAltaDeMarca> = decidirAltaDeMarca(
            pedido.codigo,
            padre === null
              ? null
              : {
                  id: padre.id,
                  nivel: padre.nivel,
                  esPrincipal: padre.esPrincipal,
                  estado: padre.estado,
                },
          );
          if (!alta.ok) return alta;
          const creada = await tx.marcas.crear({
            codigo: alta.valor.codigo,
            marcaPadreId: alta.valor.marcaPadreId,
          });
          return ok({
            salida: { marcaId: creada.id, yaExistia: false },
            constancia: {
              accion: "MARCA_CREADA",
              entidad: "marca",
              entidadId: creada.id,
              antes: null,
              despues: {
                codigo: creada.codigo,
                marcaPadreId: creada.marcaPadreId,
                nivel: creada.nivel,
                estado: creada.estado,
              },
            },
          });
        },
        comoRepeticion: (guardado) => ({ ...guardado, yaExistia: true }),
      },
    );
    return aplanarError(traducirErroresDeMarca(resultado, MOTIVOS_QUE_ADMITE));
  };
}
