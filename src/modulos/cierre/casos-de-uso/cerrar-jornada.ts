import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { huellaDeControles, type ControlDelDia, type Severidad } from "../aporte-al-cierre";
import {
  decidirCierre,
  reconocimientosValidos,
  repiteElCierre,
  type ErrorDeCierre,
  type ReconocimientoPedido,
} from "../dominio/cierre";
import { explicacionDesdeTexto } from "../dominio/explicacion";
import type { ControlGuardado } from "../persistencia/repositorio-de-jornadas";
import {
  aportesDeLaEmpresa,
  leerControles,
  referenciaDe,
  type AporteNoDisponible,
  type EntradaDeJornada,
  type ErrorDeClaveDeJornada,
} from "../comun";
import { entidadDeJornada, prepararCaso } from "./comun";
import type { DependenciasDeCierre } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCerrarJornada = EntradaDeJornada &
  Readonly<{
    /** La huella de los controles que la pantalla mostró (`controlesDeLaJornada`): nada se cierra con algo que nadie vio. */
    huellaVista: string;
    /** Qué controles `RECONOCIBLE` con hallazgos reconoce quien cierra, con su explicación opcional. */
    reconocimientos: readonly ReconocimientoPedido[];
    /** Una observación general opcional de la jornada. */
    observacion: string | null;
  }>;

/** Un control de la jornada tal como lo ve la pantalla: con su constancia si ya se cerró. */
export type ControlDeJornada = Readonly<{
  modulo: string;
  clave: string;
  severidad: Severidad;
  cantidad: number;
  /** Para navegar al detalle; la foto guardada al cerrar no las conserva (vacío). */
  referencias: readonly string[];
  reconocido: boolean;
  reconocidoEn: Date | null;
  reconocidoPor: string | null;
  texto: string | null;
}>;

export type SalidaDeCerrarJornada = Readonly<{
  controles: readonly ControlDeJornada[];
  /** `true`: la jornada ya estaba cerrada con este mismo contenido; no se escribió ni se auditó nada. */
  yaEstabaCerrada: boolean;
}>;

type ErrorPropio =
  | ErrorDeClaveDeJornada
  | "JORNADA_NO_EN_AUDITORIA"
  | "JORNADA_CERRADA"
  | "OBSERVACION_INVALIDA"
  | ErrorDeCierre
  | AporteNoDisponible;

export type ErrorAlCerrarJornada =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

const RESTRICCIONES_ADMITIDAS = ["JORNADA_CERRADA", "OBSERVACION_INVALIDA"] as const;

/** La foto guardada, tal como la devuelve el cierre (sin referencias: no se guardan). */
export function controlesDeLaFoto(guardados: readonly ControlGuardado[]): ControlDeJornada[] {
  return guardados.map((control) => ({
    modulo: control.modulo,
    clave: control.clave,
    severidad: control.severidad,
    cantidad: control.cantidad,
    referencias: [],
    reconocido: control.reconocido,
    reconocidoEn: control.reconocidoEn,
    reconocidoPor: control.reconocidoPor,
    texto: control.texto,
  }));
}

/** Resumen de lo cerrado para la auditoría: controles, cantidades y cuáles se reconocieron. Sin textos ni datos personales. */
function resumenParaAuditar(controles: readonly (ControlDelDia & { reconocido: boolean })[]) {
  return controles.map((control) => ({
    control: control.clave,
    severidad: control.severidad,
    cantidad: control.cantidad,
    reconocido: control.reconocido,
  }));
}

/**
 * «Cerrar el día» (decisiones 160, 163, 167 y 168; e3b §3.3 y §3.7). Contexto OPERATIVO con persona, serializable. Todo o nada: o el
 * cierre completo (aportes congelados, foto de controles, estado y auditoría) o nada.
 *  1. guard (`jornadas.cerrar`), la empresa opera, alcance, validación de lo pedido (reconocimientos y observación);
 *  2. `FOR UPDATE` de la jornada: dos cierres a la vez se serializan, y uno solo escribe;
 *  3. `CERRADA`: si el pedido es el mismo (huella, observación y reconocimientos) → `yaEstabaCerrada` sin escribir; otro → `JORNADA_CERRADA`;
 *     `ABIERTA` → `JORNADA_NO_EN_AUDITORIA`;
 *  4. `EN_AUDITORIA`: recalcula los controles de los módulos activos (un aporte que no responde → `APORTE_NO_DISPONIBLE`) y su huella;
 *     distinta de la que se vio → `CONTROLES_CAMBIARON`; con `BLOQUEA` → `CONTROLES_QUE_BLOQUEAN`; con `RECONOCIBLE` sin reconocer →
 *     `CONTROLES_SIN_RECONOCER` (el texto es opcional);
 *  5. cada aporte congela lo suyo (`congelarEnTx`), después la jornada pasa a `CERRADA` con su huella, se guarda la foto de controles
 *     con quién y cuándo reconoció y se audita `JORNADA_CERRADA`. Si un aporte falla, la transacción se revierte entera.
 */
export function armarCerrarJornada<TAportes>({
  transacciones,
  reglas,
  aportes,
}: DependenciasDeCierre<TAportes>) {
  return async function cerrarJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarJornada,
  ): Promise<Resultado<SalidaDeCerrarJornada, ErrorAlCerrarJornada>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCerrarJornada,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.cerrarJornada.accion,
          entrada,
        );
        if (!previo.ok) return previo;
        const { clave, persona, datos } = previo.valor;
        const reconocimientos = reconocimientosValidos(entrada.reconocimientos);
        if (!reconocimientos.ok) return reconocimientos;
        const observacion = explicacionDesdeTexto(entrada.observacion);
        if (!observacion.ok) return err("OBSERVACION_INVALIDA");
        const huellaVista = typeof entrada.huellaVista === "string" ? entrada.huellaVista : "";

        const jornada = await tx.jornadas.bloquearParaCambiar(clave);
        if (jornada === null) return err("JORNADA_NO_ENCONTRADA");

        if (jornada.estado === "CERRADA") {
          const guardados = await tx.jornadas.controlesGuardados(clave);
          const repite = repiteElCierre(
            {
              huellaDeCierre: jornada.huellaDeCierre,
              observacion: jornada.observacion,
              reconocidos: guardados.filter((control) => control.reconocido),
            },
            { huellaVista, observacion: observacion.valor, reconocimientos: reconocimientos.valor },
          );
          if (!repite) return err("JORNADA_CERRADA");
          return ok({ controles: controlesDeLaFoto(guardados), yaEstabaCerrada: true });
        }
        if (jornada.estado === "ABIERTA") return err("JORNADA_NO_EN_AUDITORIA");

        const delDia = aportesDeLaEmpresa(reglas, datos, aportes);
        const referencia = referenciaDe(clave);
        const leidos = await leerControles(tx, delDia, referencia);
        if (!leidos.ok) return leidos;
        const controles = leidos.valor;
        const huella = huellaDeControles(controles);
        const decision = decidirCierre({
          controles,
          huellaActual: huella,
          huellaVista,
          reconocimientos: reconocimientos.valor,
        });
        if (!decision.ok) return decision;

        for (const aporte of delDia) {
          const congelado = await aporte.congelarEnTx(
            tx,
            contexto,
            referencia,
            reconocimientos.valor
              .filter((reconocimiento) => reconocimiento.modulo === aporte.modulo)
              .map(({ clave: control, texto }) => ({ clave: control, texto })),
          );
          if (!congelado.ok) return err({ codigo: "APORTE_NO_DISPONIBLE", modulo: aporte.modulo });
        }

        await tx.jornadas.cerrar(clave, persona, contexto.ahora, huella, observacion.valor);
        await tx.jornadas.guardarControles(clave, decision.valor, {
          persona,
          ahora: contexto.ahora,
        });
        await tx.auditoria.registrar({
          empresaId: contexto.empresaId,
          actorPersonaId: persona,
          accion: "JORNADA_CERRADA",
          entidad: "jornada",
          entidadId: entidadDeJornada(clave),
          antes: { estado: "EN_AUDITORIA" },
          despues: {
            estado: "CERRADA",
            huella,
            controles: resumenParaAuditar(decision.valor),
          },
        });
        return ok({
          controles: decision.valor.map((control) => ({
            modulo: control.modulo,
            clave: control.clave,
            severidad: control.severidad,
            cantidad: control.cantidad,
            referencias: control.referencias,
            reconocido: control.reconocido,
            reconocidoEn: control.reconocido ? contexto.ahora : null,
            reconocidoPor: control.reconocido ? persona : null,
            texto: control.texto,
          })),
          yaEstabaCerrada: false,
        });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
