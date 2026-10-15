import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirConfirmacionDeMarca,
  resolverDefinicion,
  traducirErroresDeMarca,
  versionVigente,
  type DefinicionDeMarca,
  type ErrorDeConfirmacion,
  type MarcaGuardada,
  type PlanPorDefecto,
} from "../../modulos/marcas/publico";
import { marcaComercialId, type MarcaComercialId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { validarLargoDelMotivo, validarVigencia } from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { datosDeLaDefinicion, paresDeVocabulario } from "./datos-de-marcas";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  instanteISO,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
  type TxDeMarcasYPlanes,
} from "./marcas-y-planes-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_CONFIRMAR_VERSION_DE_MARCA = "marcas.confirmar_version";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_CONFIRMAR_VERSION_DE_MARCA = {
  accion: "marcas.confirmar_version",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeConfirmarVersionDeMarca = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN confirmar otra versión ni auditar de nuevo. */
  claveDeIdempotencia: string;
  marcaId: string;
  /** Desde cuándo rige la versión. No puede ser retroactiva (se tolera un minuto de reloj). */
  vigenteDesde: Date;
  motivo: string;
  /** Hay una versión programada que esta deja sin efecto: hay que decirlo (`CAMBIO_PROGRAMADO_PENDIENTE`). */
  reemplazaProgramada: boolean;
}>;

export type SalidaDeConfirmarVersionDeMarca = Readonly<{
  /** El número consecutivo de la versión dentro de su marca. */
  numero: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "MARCA_NO_ENCONTRADA",
  "MARCA_RETIRADA",
  "VIGENCIA_RETROACTIVA",
] as const;

type ErrorPropio =
  | ErrorDeConfirmacion
  | "ID_INVALIDO"
  | "VIGENCIA_INVALIDA"
  | "MOTIVO_DEMASIADO_LARGO"
  | "MARCA_NO_ENCONTRADA"
  | "MARCA_RETIRADA";

export type ErrorAlConfirmarVersionDeMarca = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{
  marcaId: MarcaComercialId;
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
}>;

/** Cuántos ancestros mira la herencia: el padre y el abuelo (la base admite dos niveles bajo la principal). */
const ANCESTROS_QUE_HEREDAN = 2;

/**
 * Las definiciones VIGENTES del padre y del abuelo de la marca, en ese orden (`null`: ese ancestro no
 * tiene versión vigente todavía). Se leen dentro de la transacción: una confirmación del padre y la de la
 * hija a la vez quedan en algún orden serial.
 */
async function ancestrosDe(
  tx: TxDeMarcasYPlanes,
  marca: MarcaGuardada,
  ahora: Date,
): Promise<(DefinicionDeMarca | null)[]> {
  const definiciones: (DefinicionDeMarca | null)[] = [];
  let actual = marca;
  while (actual.marcaPadreId !== null && definiciones.length < ANCESTROS_QUE_HEREDAN) {
    const padre = await tx.marcas.obtener(actual.marcaPadreId);
    if (padre === null) break;
    const vigente = versionVigente(await tx.marcas.confirmadasDe(padre.id), ahora);
    definiciones.push(vigente === null ? null : vigente.definicion);
    actual = padre;
  }
  return definiciones;
}

/**
 * El plan por defecto al que apunta la definición resuelta, con lo que la confirmación necesita de él: si
 * está retirado y los módulos que incluye su última versión publicada (el techo de lo que puede traer una
 * empresa nueva). `null` si la definición no apunta a ninguno (la confirmación dirá que está incompleta).
 */
async function planPorDefectoDe(
  tx: TxDeMarcasYPlanes,
  borrador: DefinicionDeMarca,
  ancestros: readonly (DefinicionDeMarca | null)[],
): Promise<PlanPorDefecto | null> {
  const resuelta = resolverDefinicion([borrador, ...ancestros]);
  if (resuelta.planPorDefectoId === null) return null;
  const plan = await tx.planes.obtenerPlan(resuelta.planPorDefectoId);
  if (plan === null) return null;
  const publicadas = await tx.planes.publicadasDe(plan.id);
  const ultima = publicadas.at(-1);
  return {
    id: plan.id,
    retirado: plan.estado === "RETIRADO",
    modulos: ultima === undefined ? [] : ultima.modulos,
  };
}

/**
 * Confirmar la versión de una marca (M5). Contexto de PLATAFORMA, solo ADMIN. Convierte el borrador en la
 * versión siguiente de la marca: queda congelada para siempre (otra versión la corrige) y rige desde la
 * fecha indicada, con «la última decisión manda». Antes de confirmar se verifica que la definición
 * RESUELTA con la herencia esté completa, que los colores se lean (contraste) y que los módulos iniciales
 * entren en el plan por defecto. Deja la constancia `MARCA_VERSION_CONFIRMADA` con la diferencia contra la
 * versión que regía (el vocabulario, como pares texto, antes, después). Dos confirmaciones del mismo
 * borrador a la vez: una sola confirma y la otra ve que ya no hay borrador (`SIN_BORRADOR`), salvo que sea
 * la misma clave, que devuelve lo mismo.
 */
export function armarConfirmarVersionDeMarca(dependencias: DependenciasDeMarcasYPlanes) {
  return async function confirmarVersionDeMarca(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeConfirmarVersionDeMarca,
  ): Promise<Resultado<SalidaDeConfirmarVersionDeMarca, ErrorAlConfirmarVersionDeMarca>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeConfirmarVersionDeMarca,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_CONFIRMAR_VERSION_DE_MARCA.accion,
      operacion: OPERACION_CONFIRMAR_VERSION_DE_MARCA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const marca = uuidDesdeTexto(entrada.marcaId);
        if (!marca.ok) return marca;
        const vigencia = validarVigencia(entrada.vigenteDesde);
        if (!vigencia.ok) return vigencia;
        const motivo = validarLargoDelMotivo(entrada.motivo);
        if (!motivo.ok) return motivo;
        return ok({
          entrada: {
            marcaId: marca.valor,
            vigenteDesde: instanteISO(vigencia.valor),
            motivo: motivo.valor.trim(),
            reemplazaProgramada: entrada.reemplazaProgramada,
          },
          valor: {
            marcaId: marcaComercialId(marca.valor),
            vigenteDesde: vigencia.valor,
            motivo: motivo.valor,
            reemplazaProgramada: entrada.reemplazaProgramada,
          },
        });
      },
      trabajar: async (tx, pedido) => {
        const marca = await tx.marcas.obtener(pedido.marcaId);
        if (marca === null) return err("MARCA_NO_ENCONTRADA");
        if (marca.estado === "RETIRADA") return err("MARCA_RETIRADA");

        const borrador = await tx.marcas.borradorDe(pedido.marcaId);
        const confirmadas = await tx.marcas.confirmadasDe(pedido.marcaId);
        const ancestros = await ancestrosDe(tx, marca, contexto.ahora);
        const planPorDefecto =
          borrador === null ? null : await planPorDefectoDe(tx, borrador.definicion, ancestros);

        const decision = decidirConfirmacionDeMarca({
          borrador: borrador === null ? null : borrador.definicion,
          ancestros,
          versiones: confirmadas,
          planPorDefecto,
          pedido: {
            vigenteDesde: pedido.vigenteDesde,
            motivo: pedido.motivo,
            reemplazaProgramada: pedido.reemplazaProgramada,
          },
          ahora: contexto.ahora,
        });
        if (!decision.ok) return decision;
        // `decidirConfirmacionDeMarca` solo confirma con un borrador.
        if (borrador === null) throw new RangeError("se confirmó una marca sin borrador");

        const numero = (confirmadas.at(-1)?.numero ?? 0) + 1;
        const confirmada = await tx.marcas.confirmar(borrador.id, borrador.version, {
          numero,
          vigenteDesde: decision.valor.vigenteDesde,
          motivo: decision.valor.motivo,
          reemplazaProgramada: pedido.reemplazaProgramada,
          confirmadaEn: contexto.ahora,
        });
        // Con SERIALIZABLE otra transacción que cambiara el borrador antes ya habría abortado ésta (40001, que
        // el adaptador reintenta): sin fila acá es un nivel de aislamiento menor y se pide repetir.
        if (confirmada === null) return err({ tipo: "ConcurrenciaAgotada" });

        const regia = versionVigente(confirmadas, contexto.ahora);
        return ok({
          salida: { numero: confirmada.numero },
          constancia: {
            accion: "MARCA_VERSION_CONFIRMADA",
            entidad: "marca",
            entidadId: marca.id,
            antes:
              regia === null
                ? null
                : { numero: regia.numero, ...datosDeLaDefinicion(regia.definicion) },
            despues: {
              numero: confirmada.numero,
              vigenteDesde: instanteISO(confirmada.vigenteDesde),
              motivo: confirmada.motivo,
              reemplazaProgramada: confirmada.reemplazaProgramada,
              ...datosDeLaDefinicion(confirmada.definicion),
              vocabulario: paresDeVocabulario(
                regia === null ? null : regia.definicion,
                confirmada.definicion,
              ),
            },
          },
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDeMarca(resultado, MOTIVOS_QUE_ADMITE));
  };
}
