import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirEdicionDeCaja,
  nombreDeCajaValido,
  type ErrorDeNombreDeCaja,
} from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarCaja = Readonly<{
  cajaId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  nombre: string;
}>;

export type SalidaDeEditarCaja = Readonly<{
  /** La versión vigente después de la edición (o la actual, si el nombre ya era ese). */
  version: number;
}>;

type ErrorPropio = ErrorDeNombreDeCaja | "CAJA_NO_ENCONTRADA" | "VERSION_DESACTUALIZADA";

export type ErrorAlEditarCaja =
  | ErrorPropio
  | "CAJA_DUPLICADA"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = ["NOMBRE_DE_CAJA_INVALIDO", "CAJA_DUPLICADA"] as const;

/**
 * Cambiar el nombre de una caja (e3 §3.2). Contexto OPERATIVO con persona, en una transacción serializable: guard (`cajas.editar`), la
 * empresa opera, alcance sobre la sucursal de la caja (la caja que no existe en la empresa da `CAJA_NO_ENCONTRADA`), validación del nombre
 * y el dominio decide (`decidirEdicionDeCaja`):
 *  - ya tiene ese nombre → ok sin escribir ni auditar (repetir una edición ya aplicada es idempotente, aunque la versión sea vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría `CAJA_EDITADA` con el antes y el después. Otra caja de la sucursal con ese
 *    nombre (sin distinguir mayúsculas) → `CAJA_DUPLICADA`.
 * Dos ediciones simultáneas con la misma versión: gana una; la otra, tras el reintento serializable, ve la versión nueva.
 */
export function armarEditarCaja({ transacciones, reglas }: DependenciasDeCaja) {
  return async function editarCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarCaja,
  ): Promise<Resultado<SalidaDeEditarCaja, ErrorAlEditarCaja>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeEditarCaja,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.editarCaja.accion);
        if (!previo.ok) return previo;
        const actual = await tx.cajas.obtener(empresaId, entrada.cajaId);
        if (actual === null) return err("CAJA_NO_ENCONTRADA");
        const alcance = await exigirAlcance(tx, contexto, actual.sucursalId);
        if (!alcance.ok) return alcance;
        const nombre = nombreDeCajaValido(entrada.nombre);
        if (!nombre.ok) return nombre;

        const decision = decidirEdicionDeCaja(actual, entrada.versionEsperada, nombre.valor);
        if (!decision.ok) return decision;
        if (decision.valor === "SIN_CAMBIOS") return ok({ version: actual.version });

        const editada = await tx.cajas.editarNombre(
          empresaId,
          actual.id,
          actual.version,
          nombre.valor,
        );
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CAJA_EDITADA",
          entidad: "caja",
          entidadId: actual.id,
          antes: { nombre: actual.nombre },
          despues: { nombre: editada.nombre },
        });
        return ok({ version: editada.version });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
