import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type {
  DependenciasDeConsultasDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { ErrorDeCatalogo } from "../casos-de-uso/errores";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Una cuenta de imagen ACTIVA de la empresa tal como la ve quien la administra: la que se puede retirar (con la versión que se vio). */
export type CuentaDeImagenParaAdministrar = Readonly<{
  id: string;
  proveedor: "CLOUDINARY";
  cuenta: string;
  version: number;
}>;

/**
 * Las cuentas de imagen que la empresa tiene declaradas y activas (0102), de la más vieja a la más nueva. De SOLO lectura: exige `vidrieras.administrar_cuentas_de_imagen` (como declarar y retirar:
 * una sola acción, DEC-1410) dentro de la transacción; lo de otra empresa no se ve nunca. Las retiradas no se listan: quedan en la base con quién las retiró y por qué.
 */
export function crearConsultasDeCuentasDeImagen(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<R<S>>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirAccion(
          d.reglas,
          DECLARACIONES_DE_CONSULTAS.listarCuentasDeImagen.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return trabajo(tx);
      },
    );

  return {
    listarCuentasDeImagen: (
      contexto: ContextoOperativo,
    ): Promise<R<readonly CuentaDeImagenParaAdministrar[]>> =>
      leer(contexto, async (tx) =>
        ok(
          (await tx.cuentasDeImagen.activas(contexto.empresaId)).map((c) => ({
            id: c.id,
            proveedor: c.proveedor,
            cuenta: c.cuenta,
            version: c.version,
          })),
        ),
      ),
  };
}
