import type { ReglasDeEmpresa } from "../../capacidades/permisos/empresa";
import { err, ok } from "../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../primitivas/tiempo/fecha-de-negocio";
import type { GanchoAlDesactivarSucursal, TxDeEmpresas } from "../empresas/publico";
import { huellaDeControles, type RegistroDeAportes } from "./aporte-al-cierre";
import { aportesDeLaEmpresa, exigirAportesDeModulosDistintos, referenciaDe } from "./comun";
import type { TxDeCierre } from "./casos-de-uso/contrato";
import { entidadDeJornada } from "./casos-de-uso/comun";
import { decidirAlDesactivar, decidirConMovimiento } from "./dominio/jornada";

/**
 * EL GANCHO DE CIERRE PARA `desactivarSucursal` (decisión 178, 09/11/2026; puerto `GanchoAlDesactivarSucursal` de empresas). En la MISMA
 * transacción serializable que desactiva la sucursal, sobre su jornada VIGENTE (la fecha de negocio de `contexto.ahora` con la zona y el
 * corte de la sucursal), tomada con `FOR UPDATE`:
 *  - sin jornada o ya cerrada: no hay nada abierto, no se toca;
 *  - `EN_AUDITORIA`: se rechaza (`SUCURSAL_CON_JORNADA_EN_AUDITORIA`);
 *  - `ABIERTA`: cada aporte de los módulos de la empresa dice si tiene movimiento (`hayMovimiento`). Con movimiento en alguno se rechaza
 *    pidiendo hacer antes el cierre del día (`SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA`); un aporte que no responde, o no poder fechar la
 *    jornada, también rechaza (`JORNADA_NO_VERIFICABLE`, falla cerrado). Sin movimiento en ninguno, la jornada pasa sola por
 *    `EN_AUDITORIA` a `CERRADA` con quien desactiva y su `ahora` (la base exige las dos marcas) y se audita
 *    `JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL`. No hay controles que congelar ni reconocer (no hay nada que revisar): la huella es la de
 *    una lista vacía.
 * Atomicidad y carrera: todo corre en la transacción de `desactivarSucursal`. Quien registra actividad toma la jornada con `FOR SHARE`
 * (`asegurarAbiertaEnTx`) y la actividad entra antes (se ve el movimiento y se rechaza) o espera y, bajo `SERIALIZABLE`, se repite y ve la
 * sucursal ya inactiva; si la jornada no existía, la inserción concurrente rompe la serializabilidad y una de las dos repite.
 * Solo importa los TIPOS de empresas. Se registra en la composición (`armarWeb`). Previene desactivar una sucursal con dinero sin contar o
 * en medio del cierre del día. Chequeo: `test/integracion/desactivar-sucursal-jornada*.test.ts`.
 */
export function crearGanchoDeCierreAlDesactivar<TAportes>({
  reglas,
  aportes,
}: Readonly<{
  reglas: ReglasDeEmpresa;
  aportes: RegistroDeAportes<TAportes>;
}>): GanchoAlDesactivarSucursal<TxDeEmpresas & TxDeCierre & TAportes> {
  exigirAportesDeModulosDistintos(aportes);
  return {
    async alDesactivarSucursalEnTx(tx, contexto, sucursal, datos) {
      const fecha = fechaDeNegocio(contexto.ahora, datos.zonaHoraria, datos.horaDeCorte);
      if (!fecha.ok || contexto.personaId === null) return err("JORNADA_NO_VERIFICABLE");
      const clave = {
        empresa: contexto.empresaId,
        sucursal: sucursal.sucursalId,
        fecha: fecha.valor,
      };
      const jornada = await tx.jornadas.bloquearParaCambiar(clave);
      const decision = decidirAlDesactivar(jornada === null ? "SIN_ACTIVIDAD" : jornada.estado);
      if (!decision.ok) return decision;
      if (decision.valor === "NADA_QUE_CERRAR") return ok(null);

      const delActor = await tx.autorizacion.delActor(contexto);
      for (const aporte of aportesDeLaEmpresa(reglas, delActor, aportes)) {
        const movimiento = await aporte.hayMovimiento(tx, referenciaDe(clave));
        if (!movimiento.ok) return err("JORNADA_NO_VERIFICABLE");
        const sigue = decidirConMovimiento(movimiento.valor);
        if (!sigue.ok) return sigue;
      }

      await tx.jornadas.iniciarAuditoria(clave, contexto.personaId, contexto.ahora);
      const huella = huellaDeControles([]);
      await tx.jornadas.cerrar(clave, contexto.personaId, contexto.ahora, huella, null);
      await tx.auditoria.registrar({
        empresaId: contexto.empresaId,
        actorPersonaId: contexto.personaId,
        accion: "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL",
        entidad: "jornada",
        entidadId: entidadDeJornada(clave),
        antes: { estado: "ABIERTA" },
        despues: { estado: "CERRADA", huella, sucursal: sucursal.nombre },
      });
      return ok(null);
    },
  };
}
