import { err, ok } from "../../../primitivas/resultado/resultado";
import type {
  AporteAlCierreDelDia,
  JornadaRef,
  ReconocimientoDeControl,
} from "../../cierre/publico";
import { lineaPorExplicar } from "../dominio/conciliacion";
import { CONTROLES_DE_CAJA } from "../dominio/controles";
import {
  controlesDeCaja,
  explicacionDelReconocimiento,
  impedimentosDeCaja,
} from "../dominio/controles-del-dia";
import type { LineaDeFoto, OrigenDeFoto } from "../persistencia/repositorio-de-fotos";
import type { TxDeAporteDeCaja } from "./contrato";
import { datosParaLosControles, leerLaJornada } from "./la-jornada";
import type { TicketsPorCobranza } from "./tickets-por-cobranza";

/**
 * EL APORTE DE CAJA AL CIERRE DEL DÍA (e3b §3.4 y §4; `AporteAlCierreDelDia` del módulo `cierre`). Lo registra la composición: `cierre` no
 * conoce a caja. Los seis controles y sus severidades son del dominio (`controlesDeCaja`); acá se lee la jornada (una sola regla, la misma
 * que muestra `conciliacionDeLaJornada`) y se congela la foto en la transacción del cierre.
 *  - `impedimentos`: las sesiones sin cerrar (impiden EMPEZAR a contar el día).
 *  - `controles`: solo lectura, sin reloj ni azar: con los mismos datos, la misma huella. Cualquier dato que no se pueda leer (ventas no
 *    informó un ticket, una línea de arqueo rota) es `APORTE_NO_DISPONIBLE`: el día no se cierra con un dato que no se leyó.
 *  - `congelarEnTx`: recalcula TODO en esta transacción (con la jornada todavía `EN_AUDITORIA`: la cierra `cierre` después, en la misma
 *    transacción) y guarda la cabecera, una línea por (medio, cuenta) y los orígenes con diferencia contra el ticket, copiando de los
 *    reconocimientos la explicación opcional. No abre savepoints (la base compara el `xmin` de la transacción de nivel superior) y al
 *    confirmar la base vuelve a verificar que la foto cuadre. Un solo `INSERT` por tabla; si algo falla, no se cierra nada.
 * Previene: un cierre con una conciliación que no es la que se vio, y un total de ticket inventado cuando ventas no responde.
 */
export function crearAporteDeCaja({
  tickets,
}: Readonly<{ tickets: TicketsPorCobranza }>): AporteAlCierreDelDia<TxDeAporteDeCaja> {
  const leer = (tx: TxDeAporteDeCaja, j: JornadaRef) =>
    leerLaJornada(tx, j.empresaId, j.sucursalId, j.fechaDeNegocio, tickets);

  return {
    modulo: "caja",

    async impedimentos(tx, j) {
      const sesiones = await tx.sesiones.deLaJornada(j.empresaId, j.sucursalId, j.fechaDeNegocio);
      return ok(
        impedimentosDeCaja(sesiones.map((s) => ({ id: s.id, estado: s.estado, arqueo: [] }))),
      );
    },

    async controles(tx, j) {
      const jornada = await leer(tx, j);
      return jornada.ok ? ok(controlesDeCaja(datosParaLosControles(jornada.valor))) : jornada;
    },

    async congelarEnTx(tx, contexto, j, reconocidos: readonly ReconocimientoDeControl[]) {
      if (contexto.personaId === null) return err("APORTE_NO_DISPONIBLE");
      const jornada = await leer(tx, j);
      if (!jornada.ok) return jornada;
      const deLaConciliacion = explicacionDelReconocimiento(
        reconocidos,
        CONTROLES_DE_CAJA.CONCILIACION_POR_MEDIO,
      );
      const deLosTickets = explicacionDelReconocimiento(
        reconocidos,
        CONTROLES_DE_CAJA.COBRADO_CONTRA_TICKET,
      );
      const lineas: LineaDeFoto[] = jornada.valor.lineas.map((l) => ({
        medioDePagoId: l.medioDePagoId,
        cuentaDeCobroId: l.cuentaDeCobroId,
        registrado: l.registrado,
        correcciones: l.correcciones,
        declarado: l.declarado,
        estado: l.estado,
        conformePor: l.conformePor,
        conformeEn: l.conformeEn,
        // Solo lo que había que explicar lleva explicación: una línea conforme o sin diferencia no tiene nada que explicar.
        explicacion: lineaPorExplicar(l) ? deLaConciliacion : null,
      }));
      const origenes: OrigenDeFoto[] = jornada.valor.diferenciasDeTicket.map((d) => ({
        origenTipo: d.origen.tipo,
        origenId: d.origen.id,
        ticketId: d.ticketId,
        cobrado: d.cobrado,
        totalDelTicket: d.totalDelTicket,
        explicacion: deLosTickets,
      }));
      await tx.fotos.guardar({
        empresa: j.empresaId,
        sucursal: j.sucursalId,
        fecha: j.fechaDeNegocio,
        congeladoEn: contexto.ahora,
        congeladoPor: contexto.personaId,
        lineas,
        origenes,
      });
      await tx.auditoria.registrar({
        empresaId: contexto.empresaId,
        actorPersonaId: contexto.personaId,
        accion: "CIERRE_DE_CAJA_CONGELADO",
        entidad: "cierre_de_caja_de_jornada",
        entidadId: `${j.sucursalId}:${j.fechaDeNegocio}`,
        despues: {
          lineas: lineas.length,
          origenesConDiferencia: origenes.length,
          correcciones: jornada.valor.correcciones.length,
          ajustesAJornadasCerradas: jornada.valor.ajustes.length,
        },
      });
      return ok(null);
    },
  };
}
