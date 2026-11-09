import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { huellaDeControles, ordenarControles, type Severidad } from "../aporte-al-cierre";
import {
  aportesDeLaEmpresa,
  leerControles,
  referenciaDe,
  type AporteNoDisponible,
  type EntradaDeJornada,
} from "../comun";
import type { EstadoConsultado } from "../dominio/jornada";
import { prepararConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCierre } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeControlesDeLaJornada = EntradaDeJornada;

export type ControlDeLaPantalla = Readonly<{
  modulo: string;
  clave: string;
  severidad: Severidad;
  cantidad: number;
  /** Para navegar al detalle (lo da cada módulo con su propio permiso de lectura); la foto de una jornada cerrada no las guarda. */
  referencias: readonly string[];
  /** Solo en una jornada cerrada: si se reconoció, con quién y cuándo. */
  reconocido?: boolean;
  reconocidoPor?: string | null;
  reconocidoEn?: Date | null;
  texto?: string | null;
}>;

export type ControlesDeLaJornada = Readonly<{
  estado: EstadoConsultado;
  /** La huella de lo que se muestra: es la `huellaVista` que `cerrarJornada` vuelve a comparar. De la foto guardada si ya cerró. */
  huella: string;
  controles: readonly ControlDeLaPantalla[];
}>;

export type ErrorAlPedirLosControlesDeLaJornada =
  ErrorDeConsulta | AporteNoDisponible | ErrorDePersistencia;

/**
 * Los controles del día de una sucursal (e3b §3.3). Mientras la jornada no está `CERRADA` se calculan EN VIVO con los aportes de los
 * módulos activos de la empresa (un aporte que no responde → `APORTE_NO_DISPONIBLE`: nunca se muestra un día incompleto como si
 * estuviera bien); cerrada, es la foto que se guardó al cerrar. `SIN_ACTIVIDAD` (la jornada todavía no existe): sin controles, con la
 * huella de la lista vacía (SUPUESTO: no hay nada que revisar ni cerrar). `jornadas.ver`, `read committed`, alcance de sucursal. Los
 * detalles de cada control los dan las consultas de cada módulo con su propio permiso.
 */
export function armarControlesDeLaJornada<TAportes>({
  transacciones,
  reglas,
  aportes,
}: DependenciasDeConsultasDeCierre<TAportes>) {
  return async function controlesDeLaJornada(
    contexto: ContextoOperativo,
    entrada: EntradaDeControlesDeLaJornada,
  ): Promise<Resultado<ControlesDeLaJornada, ErrorAlPedirLosControlesDeLaJornada>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<ControlesDeLaJornada, ErrorDeConsulta | AporteNoDisponible>> => {
        const previo = await prepararConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.controlesDeLaJornada.accion,
          entrada,
        );
        if (!previo.ok) return previo;
        const { clave, datos } = previo.valor;
        const jornada = await tx.jornadas.obtener(clave);
        if (jornada === null) {
          return ok({ estado: "SIN_ACTIVIDAD", huella: huellaDeControles([]), controles: [] });
        }
        if (jornada.estado === "CERRADA") {
          const guardados = await tx.jornadas.controlesGuardados(clave);
          return ok({
            estado: "CERRADA",
            // La huella con la que se cerró, tal cual: es lo que vio quien cerró.
            huella: jornada.huellaDeCierre ?? huellaDeControles([]),
            controles: guardados.map((control) => ({
              modulo: control.modulo,
              clave: control.clave,
              severidad: control.severidad,
              cantidad: control.cantidad,
              referencias: [],
              reconocido: control.reconocido,
              reconocidoPor: control.reconocidoPor,
              reconocidoEn: control.reconocidoEn,
              texto: control.texto,
            })),
          });
        }
        const leidos = await leerControles(
          tx,
          aportesDeLaEmpresa(reglas, datos, aportes),
          referenciaDe(clave),
        );
        if (!leidos.ok) return leidos;
        return ok({
          estado: jornada.estado,
          huella: huellaDeControles(leidos.valor),
          controles: ordenarControles(leidos.valor).map((control) => ({
            modulo: control.modulo,
            clave: control.clave,
            severidad: control.severidad,
            cantidad: control.cantidad,
            referencias: control.referencias,
          })),
        });
      },
    );
  };
}
