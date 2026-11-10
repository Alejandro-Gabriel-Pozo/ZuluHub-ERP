import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirEdicionDeCuenta,
  identificadorExternoValido,
  nombreDeCuentaValido,
  type ErrorDeIdentificadorExterno,
  type ErrorDeNombreDeCuenta,
} from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso, sucursalDeLaEntrada } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarCuentaDeCobro = Readonly<{
  cuentaDeCobroId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  nombre: string;
  /** `null`: sin dato (borra el que tenía). */
  identificadorExterno: string | null;
  sucursalId: string;
}>;

export type SalidaDeEditarCuentaDeCobro = Readonly<{
  /** La versión vigente después de la edición (o la actual, si ya era lo pedido). */
  version: number;
}>;

type ErrorPropio =
  | ErrorDeNombreDeCuenta
  | ErrorDeIdentificadorExterno
  | "CUENTA_DE_COBRO_NO_ENCONTRADA"
  | "SUCURSAL_NO_ENCONTRADA"
  | "VERSION_DESACTUALIZADA";

export type ErrorAlEditarCuentaDeCobro =
  | ErrorPropio
  | "CUENTA_DUPLICADA"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = [
  "NOMBRE_DE_CUENTA_INVALIDO",
  "IDENTIFICADOR_EXTERNO_INVALIDO",
  "SUCURSAL_NO_ENCONTRADA",
  "CUENTA_DUPLICADA",
] as const;

/**
 * Cambiar el nombre, el identificador externo o la sucursal de una cuenta de cobro (e3 §3.2; el tipo no cambia nunca). Contexto
 * OPERATIVO con persona, en una transacción serializable: guard (`cuentas_de_cobro.editar`), la empresa opera, alcance sobre la sucursal
 * de la cuenta y sobre la nueva, validación y el dominio decide (`decidirEdicionDeCuenta`): no existe → `CUENTA_DE_COBRO_NO_ENCONTRADA`;
 * ya es lo pedido → ok sin escribir ni auditar (aunque la versión sea vieja); la versión no es la vigente → `VERSION_DESACTUALIZADA`; si
 * no, `UPDATE` condicionado a la versión y auditoría `CUENTA_DE_COBRO_EDITADA`. Otra cuenta con ese nombre → `CUENTA_DUPLICADA`. La
 * auditoría no lleva el identificador externo, solo si cambió. Lo ya cobrado no se toca.
 */
export function armarEditarCuentaDeCobro({ transacciones, reglas }: DependenciasDeCaja) {
  return async function editarCuentaDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarCuentaDeCobro,
  ): Promise<Resultado<SalidaDeEditarCuentaDeCobro, ErrorAlEditarCuentaDeCobro>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeEditarCuentaDeCobro,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.editarCuentaDeCobro.accion,
        );
        if (!previo.ok) return previo;
        const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const actual = await tx.cuentasDeCobro.obtener(empresaId, entrada.cuentaDeCobroId);
        if (actual === null) return err("CUENTA_DE_COBRO_NO_ENCONTRADA");
        for (const donde of new Set([actual.sucursalId, sucursal.valor])) {
          const alcance = await exigirAlcance(tx, contexto, donde);
          if (!alcance.ok) return alcance;
        }
        const nombre = nombreDeCuentaValido(entrada.nombre);
        if (!nombre.ok) return nombre;
        const identificador = identificadorExternoValido(entrada.identificadorExterno);
        if (!identificador.ok) return identificador;

        const cambios = {
          nombre: nombre.valor,
          identificadorExterno: identificador.valor,
          sucursalId: sucursal.valor,
        };
        const decision = decidirEdicionDeCuenta(actual, entrada.versionEsperada, cambios);
        if (!decision.ok) return decision;
        if (decision.valor === "SIN_CAMBIOS") return ok({ version: actual.version });

        if (sucursal.valor !== actual.sucursalId) {
          const nueva = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
            empresaId,
            sucursal.valor,
          );
          if (nueva === null) return err("SUCURSAL_NO_ENCONTRADA");
        }
        const editada = await tx.cuentasDeCobro.editar(
          empresaId,
          actual.id,
          actual.version,
          cambios,
        );
        if (editada === null) return err("VERSION_DESACTUALIZADA");
        const cambiaNombre = actual.nombre !== editada.nombre;
        const cambiaSucursal = actual.sucursalId !== editada.sucursalId;
        const cambiaIdentificador = actual.identificadorExterno !== editada.identificadorExterno;
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CUENTA_DE_COBRO_EDITADA",
          entidad: "cuenta_de_cobro",
          entidadId: actual.id,
          antes: {
            ...(cambiaNombre ? { nombre: actual.nombre } : {}),
            ...(cambiaSucursal ? { sucursalId: actual.sucursalId } : {}),
            ...(cambiaIdentificador
              ? { conIdentificadorExterno: actual.identificadorExterno !== null }
              : {}),
          },
          despues: {
            ...(cambiaNombre ? { nombre: editada.nombre } : {}),
            ...(cambiaSucursal ? { sucursalId: editada.sucursalId } : {}),
            ...(cambiaIdentificador
              ? {
                  conIdentificadorExterno: editada.identificadorExterno !== null,
                  cambioElIdentificadorExterno: true,
                }
              : {}),
          },
        });
        return ok({ version: editada.version });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
