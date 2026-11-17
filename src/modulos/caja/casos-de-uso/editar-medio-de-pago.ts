import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirEdicionDeMedio,
  nombreDeMedioValido,
  type ErrorDeEdicionDeMedio,
  type ErrorDeNombreDeMedio,
} from "../dominio/configuracion";
import type { DatosQuePideElMedio } from "../dominio/medios";
import { DATOS_DEL_COBRO } from "../estados";
import { dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeEditarMedioDePago = Readonly<{
  medioDePagoId: string;
  /** La versión que la pantalla tenía al abrir la ficha (control de versión optimista). */
  versionEsperada: number;
  /** `null`: sin nombre propio. */
  nombre: string | null;
  /** Qué datos opcionales pide el medio al cobrar (decisión 129): el conjunto final, no solo lo que cambia. */
  datos: DatosQuePideElMedio;
}>;

export type SalidaDeEditarMedioDePago = Readonly<{
  /** La versión vigente después de la edición (o la actual, si ya era lo pedido). */
  version: number;
}>;

type ErrorPropio = ErrorDeNombreDeMedio | ErrorDeEdicionDeMedio;

export type ErrorAlEditarMedioDePago =
  ErrorPropio | "MEDIO_DUPLICADO" | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = ["NOMBRE_DE_MEDIO_INVALIDO", "MEDIO_DUPLICADO"] as const;

/** Los datos que pide, como se auditan: solo los que están en el conjunto final. */
function datosParaAuditar(pide: DatosQuePideElMedio): Readonly<Record<string, Dato>> {
  return Object.fromEntries(DATOS_DEL_COBRO.map((dato) => [dato, pide[dato]]));
}

/**
 * Cambiar el nombre y los datos que pide un medio de pago (e3 §3.2; decisión 129). Contexto OPERATIVO con persona, en una transacción
 * serializable: guard (`medios_de_pago.editar`), la empresa opera, validación del nombre y el dominio decide (`decidirEdicionDeMedio`):
 *  - el medio no existe en la empresa → `MEDIO_NO_ENCONTRADO`;
 *  - habilita un dato que el tipo no admite → `DATO_NO_ADMITIDO_POR_EL_MEDIO { dato }`;
 *  - ya tiene ese nombre y esos datos → ok sin escribir ni auditar (aunque la versión sea vieja);
 *  - la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`;
 *  - si no, `UPDATE` condicionado a la versión y auditoría `MEDIO_DE_PAGO_EDITADO` con el antes y el después. Otro medio con ese nombre
 *    (sin distinguir mayúsculas) → `MEDIO_DUPLICADO`.
 * Lo ya cobrado no se toca: cambiar lo que pide rige para los cobros que vengan.
 */
export function armarEditarMedioDePago({ transacciones, reglas }: DependenciasDeCaja) {
  return async function editarMedioDePago(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarMedioDePago,
  ): Promise<Resultado<SalidaDeEditarMedioDePago, ErrorAlEditarMedioDePago>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeEditarMedioDePago, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.editarMedioDePago.accion,
        );
        if (!previo.ok) return previo;
        const nombre = nombreDeMedioValido(entrada.nombre);
        if (!nombre.ok) return nombre;

        const actual = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
        const decision = decidirEdicionDeMedio(actual, entrada.versionEsperada, {
          nombre: nombre.valor,
          pide: entrada.datos,
        });
        if (!decision.ok) return decision;
        if (actual === null) throw new Error("invariante rota: se decidió editar un medio nulo");
        if (decision.valor === "SIN_CAMBIOS") return ok({ version: actual.version });

        // Solo lo que cambia entra al UPDATE y a la auditoría.
        const cambiaNombre = nombre.valor !== actual.nombre;
        const cambiaDatos = DATOS_DEL_COBRO.some(
          (dato) => actual.pide[dato] !== entrada.datos[dato],
        );
        const editado = await tx.mediosDePago.editar(empresaId, actual.id, actual.version, {
          ...(cambiaNombre ? { nombre: nombre.valor } : {}),
          ...(cambiaDatos ? { pide: entrada.datos } : {}),
        });
        if (editado === null) return err("VERSION_DESACTUALIZADA");
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "MEDIO_DE_PAGO_EDITADO",
          entidad: "medio_de_pago",
          entidadId: actual.id,
          antes: {
            ...(cambiaNombre ? { nombre: actual.nombre } : {}),
            ...(cambiaDatos ? { pide: datosParaAuditar(actual.pide) } : {}),
          },
          despues: {
            ...(cambiaNombre ? { nombre: editado.nombre } : {}),
            ...(cambiaDatos ? { pide: datosParaAuditar(editado.pide) } : {}),
          },
        });
        return ok({ version: editado.version });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
