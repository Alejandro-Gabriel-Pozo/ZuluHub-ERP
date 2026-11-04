import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirConfirmacionDeMarca,
  traducirErroresDeMarca,
  versionVigente,
  type ErrorDeConfirmacion,
} from "../../modulos/marcas/publico";
import { marcaComercialId, type MarcaComercialId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  validarLargoDelMotivo,
  validarVersionVista,
  validarVigencia,
} from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { ancestrosDe, planPorDefectoDe } from "./cadena-de-marca";
import { datosDeLaDefinicion, paresDeVocabulario } from "./datos-de-marcas";
import {
  aplanarError,
  ejecutarCasoDeMarcasYPlanes,
  instanteISO,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
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
  /**
   * La `version` del borrador que vio quien confirma (la de la ficha de la marca): OBLIGATORIA, un entero de 1 en
   * adelante. Si el borrador ya cambió (otra persona lo guardó), `VERSION_DESACTUALIZADA` y no se publica algo
   * que quien confirma no vio.
   */
  versionEsperada: number;
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
  | "VERSION_ESPERADA_INVALIDA"
  | "VERSION_DESACTUALIZADA"
  | "VIGENCIA_INVALIDA"
  | "MOTIVO_DEMASIADO_LARGO"
  | "MARCA_NO_ENCONTRADA"
  | "MARCA_RETIRADA";

export type ErrorAlConfirmarVersionDeMarca = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{
  marcaId: MarcaComercialId;
  versionEsperada: number;
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
}>;

/**
 * Confirmar la versión de una marca (M5). Contexto de PLATAFORMA, solo ADMIN. Convierte el borrador en la
 * versión siguiente de la marca: queda congelada para siempre (otra versión la corrige) y rige desde la
 * fecha indicada, con «la última decisión manda». Antes de confirmar se verifica que la definición
 * RESUELTA con la herencia esté completa, que los colores se lean (contraste) y que los módulos iniciales
 * entren en el plan por defecto. Deja la constancia `MARCA_VERSION_CONFIRMADA` con la diferencia contra la
 * versión que regía (el vocabulario, como pares texto, antes, después). Dos confirmaciones del mismo
 * borrador a la vez: una sola confirma y la otra ve que ya no hay borrador (`SIN_BORRADOR`), salvo que sea
 * la misma clave, que devuelve lo mismo. Confirma solo el borrador que quien confirma vio (`versionEsperada`):
 * si otra persona lo guardó entretanto, `VERSION_DESACTUALIZADA` y el borrador de la otra queda intacto. La
 * clave de idempotencia se mira ANTES de esa decisión: repetir el mismo pedido ya confirmado devuelve lo mismo
 * aunque el borrador ya no exista; la misma clave con otra `versionEsperada` es `CLAVE_REUTILIZADA`.
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
        const version = validarVersionVista(entrada.versionEsperada);
        if (!version.ok) return version;
        const vigencia = validarVigencia(entrada.vigenteDesde);
        if (!vigencia.ok) return vigencia;
        const motivo = validarLargoDelMotivo(entrada.motivo);
        if (!motivo.ok) return motivo;
        return ok({
          entrada: {
            marcaId: marca.valor,
            versionEsperada: version.valor,
            vigenteDesde: instanteISO(vigencia.valor),
            motivo: motivo.valor.trim(),
            reemplazaProgramada: entrada.reemplazaProgramada,
          },
          valor: {
            marcaId: marcaComercialId(marca.valor),
            versionEsperada: version.valor,
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
        // Se confirma el borrador que la persona VIO, no «el que haya»: si cambió entretanto, no se publica nada.
        // Sin borrador, `decidirConfirmacionDeMarca` dice `SIN_BORRADOR` (la segunda de dos confirmaciones a la vez).
        if (borrador !== null && borrador.version !== pedido.versionEsperada) {
          return err("VERSION_DESACTUALIZADA");
        }
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
          constancias: [
            {
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
          ],
        });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDeMarca(resultado, MOTIVOS_QUE_ADMITE));
  };
}
