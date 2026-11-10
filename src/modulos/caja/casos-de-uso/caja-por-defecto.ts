import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { NOMBRE_DE_LA_CAJA_POR_DEFECTO } from "../dominio/configuracion";
import { exigirAlcance, prepararCaso, sucursalDeLaEntrada } from "./comun";
import type { DependenciasDeCaja, TxDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

/** Lo que usa la función única: los repositorios de caja y la auditoría (los ganchos de empresas la reciben con la `Tx` compuesta). */
export type TxParaCajaPorDefecto = Pick<TxDeCaja, "cajas" | "mediosDePago" | "auditoria">;

export type SalidaDeAsegurarCaja = Readonly<{
  cajaId: string;
  /** `true`: la creó esta llamada; `false`: la sucursal ya tenía caja (activa o no) y no se escribió nada. */
  creada: boolean;
}>;

/**
 * LA función única de la «Caja 1» (dec. 165; e3 §3.2.1), usada por el gancho de `crearSucursal` y por el comando
 * `asegurarCajaPorDefecto`. Idempotente y sin guard propio (la autorización es la de quien la llama, que ya la hizo):
 *  - la sucursal ya tiene alguna caja (activa o no, con cualquier nombre) → devuelve la existente sin escribir ni auditar;
 *  - no tiene → inserta «Caja 1» con `ON CONFLICT DO NOTHING` sobre la única de nombre, asegura el medio EFECTIVO de la empresa y audita
 *    `CAJA_CREADA` (origen «por defecto») y, si lo creó, `MEDIO_DE_PAGO_CREADO`, todo en la transacción de quien llama.
 * NO pasa por el límite del plan (la primera caja siempre entra) y corre aunque el módulo `caja` no esté activo (una fila por sucursal:
 * evita que activar caja después deje sucursales sin caja). Dos a la vez: ambas ven «sin caja», la única deja pasar a una y la otra
 * reintenta (`SERIALIZABLE`) y ve la existente: una sola «Caja 1», una sola auditoría.
 * Previene una sucursal sin caja (no se podría cobrar) o con dos «Caja 1» por un doble ingreso.
 */
export async function asegurarCajaPorDefectoEnTx(
  tx: TxParaCajaPorDefecto,
  contexto: ContextoOperativo,
  sucursalId: SucursalId,
): Promise<SalidaDeAsegurarCaja> {
  const { empresaId } = contexto;
  const existente = await tx.cajas.primeraDeLaSucursal(empresaId, sucursalId);
  if (existente !== null) return { cajaId: existente.id, creada: false };

  const caja = await tx.cajas.crearSiNoExiste(empresaId, sucursalId, NOMBRE_DE_LA_CAJA_POR_DEFECTO);
  if (caja === null) {
    // Otra transacción la insertó entre la lectura y el insert: se devuelve esa, sin escribir ni auditar.
    const ganadora = await tx.cajas.primeraDeLaSucursal(empresaId, sucursalId);
    if (ganadora === null) throw new Error("invariante rota: el conflicto no dejó ninguna caja");
    return { cajaId: ganadora.id, creada: false };
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: contexto.personaId,
    accion: "CAJA_CREADA",
    entidad: "caja",
    entidadId: caja.id,
    despues: {
      nombre: caja.nombre,
      sucursalId: caja.sucursalId,
      activa: true,
      origen: "por defecto",
    },
  });
  const efectivo = await tx.mediosDePago.asegurarEfectivo(empresaId);
  if (efectivo.creado) {
    await tx.auditoria.registrar({
      empresaId,
      actorPersonaId: contexto.personaId,
      accion: "MEDIO_DE_PAGO_CREADO",
      entidad: "medio_de_pago",
      entidadId: efectivo.medio.id,
      despues: { tipo: "EFECTIVO", nombre: null, activo: true, origen: "caja" },
    });
  }
  return { cajaId: caja.id, creada: true };
}

export type EntradaDeAsegurarCajaPorDefecto = Readonly<{ sucursalId: string }>;
export type SalidaDeAsegurarCajaPorDefecto = SalidaDeAsegurarCaja;

type ErrorPropio = "SUCURSAL_NO_ENCONTRADA" | "SUCURSAL_INACTIVA";

export type ErrorAlAsegurarCajaPorDefecto =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide la lectura de la sucursal). */
const RESTRICCIONES_ADMITIDAS = ["SUCURSAL_NO_ENCONTRADA"] as const;

/**
 * El disparador de la «Caja 1» (e3 §3.2.1 b): la primera sucursal del alta de empresa, y toda sucursal sin caja, obtienen la suya cuando
 * alguien entra a caja. Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard (`sesiones_caja.abrir`,
 * los tres roles; bloqueado en solo lectura), la empresa opera, la sucursal existe en el contexto, alcance de sucursal, sucursal leída
 * con `FOR SHARE` (existe y está abierta: un cierre concurrente espera) y entonces `asegurarCajaPorDefectoEnTx`. Repetirlo devuelve la
 * misma caja con `creada: false` sin escribir ni auditar. La consulta de cajas NO escribe: la pantalla llama a este comando.
 */
export function armarAsegurarCajaPorDefecto({ transacciones, reglas }: DependenciasDeCaja) {
  return async function asegurarCajaPorDefecto(
    contexto: ContextoOperativo,
    entrada: EntradaDeAsegurarCajaPorDefecto,
  ): Promise<Resultado<SalidaDeAsegurarCajaPorDefecto, ErrorAlAsegurarCajaPorDefecto>> {
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeAsegurarCajaPorDefecto,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.asegurarCajaPorDefecto.accion,
        );
        if (!previo.ok) return previo;
        const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const alcance = await exigirAlcance(tx, contexto, sucursal.valor);
        if (!alcance.ok) return alcance;

        const deLaSucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          contexto.empresaId,
          sucursal.valor,
        );
        if (deLaSucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
        if (!deLaSucursal.activa) return err("SUCURSAL_INACTIVA");

        return ok(await asegurarCajaPorDefectoEnTx(tx, contexto, sucursal.valor));
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
