import { esCuenta } from "../../../capacidades/activos/direccion-externa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN,
  huellaDeCuentaDeImagen,
  type CuentaDeImagenDeclarada,
} from "../dominio/cuenta-de-imagen";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeDeclararCuentaDeImagen = Readonly<{
  /** Lo manda la aplicación por gesto (un clic de «Declarar»): con la huella de lo pedido es la idempotencia. */
  claveDeIdempotencia: string;
  proveedor: string;
  cuenta: string;
}>;

export type SalidaDeDeclararCuentaDeImagen = Readonly<{
  cuenta: CuentaDeImagenDeclarada;
  /** `true` si no se escribió nada: la cuenta ya se había declarado con esa clave (un clic doble, un reintento). */
  yaExistia: boolean;
}>;

/**
 * Declarar una cuenta del proveedor de imágenes como de la empresa (0102; spec de la carta §5.7.2): de ella, y solo de ella, se trae el logo de las cartas. Exige
 * `vidrieras.administrar_cuentas_de_imagen` y alcance sobre TODAS las sucursales (la cuenta es de la empresa entera). Solo `CLOUDINARY` (lista cerrada) y una cuenta con la
 * forma del proveedor. Hasta 2 activas por empresa (el tope lo serializa la base: dos altas a la vez no pasan de 2) y la misma cuenta activa una sola vez por empresa;
 * en OTRA empresa puede estar declarada (una agencia lleva a varios clientes). NO se prueba que la cuenta sea de quien la declara (spec §5.7.5: no entra en v1).
 * Idempotente por clave y huella: repetir el mismo gesto devuelve lo hecho sin escribir ni auditar (`yaExistia`); la misma clave con otra cuenta es `CLAVE_REUTILIZADA`.
 * Auditoría: `CUENTA_DE_IMAGEN_DECLARADA` en la misma transacción.
 */
export function armarDeclararCuentaDeImagen(dependencias: DependenciasDeCatalogo) {
  return async function declararCuentaDeImagen(
    contexto: ContextoOperativo,
    entrada: EntradaDeDeclararCuentaDeImagen,
  ): Promise<R<SalidaDeDeclararCuentaDeImagen>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDeclararCuentaDeImagen>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          DECLARACIONES.declararCuentaDeImagen.accion,
        ]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        // Quien declara o retira queda registrado: sin persona (el sistema) no se puede.
        const persona = contexto.personaId;
        if (persona === null) return err("SIN_PERMISO");
        if (
          typeof entrada.claveDeIdempotencia !== "string" ||
          !FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN.test(entrada.claveDeIdempotencia)
        )
          return err("IDENTIFICADOR_INVALIDO");
        if (entrada.proveedor !== "CLOUDINARY" || !esCuenta(entrada.cuenta))
          return err("CUENTA_DE_IMAGEN_INVALIDA");
        const huella = huellaDeCuentaDeImagen(entrada.proveedor, entrada.cuenta);

        const repetida = async (): Promise<R<SalidaDeDeclararCuentaDeImagen> | null> => {
          const previa = await tx.cuentasDeImagen.porClave(empresaId, entrada.claveDeIdempotencia);
          if (previa === null) return null;
          return previa.huella === huella
            ? ok({ cuenta: previa.cuenta, yaExistia: true })
            : err("CLAVE_REUTILIZADA");
        };
        const yaEra = await repetida();
        if (yaEra !== null) return yaEra;
        if (
          (await tx.cuentasDeImagen.activaDe(empresaId, entrada.proveedor, entrada.cuenta)) !== null
        )
          return err("CUENTA_DE_IMAGEN_YA_DECLARADA");

        const insertada = await tx.cuentasDeImagen.insertar(empresaId, {
          proveedor: entrada.proveedor,
          cuenta: entrada.cuenta,
          claveDeIdempotencia: entrada.claveDeIdempotencia,
          huella,
          declaradaPor: persona,
        });
        if (insertada === null) {
          // Otro pedido llegó primero con la misma clave o con la misma cuenta activa: se mira cuál.
          const carrera = await repetida();
          if (carrera !== null) return carrera;
          if (
            (await tx.cuentasDeImagen.activaDe(empresaId, entrada.proveedor, entrada.cuenta)) !==
            null
          )
            return err("CUENTA_DE_IMAGEN_YA_DECLARADA");
          throw new Error("la cuenta de imagen no se insertó y no hay con qué se haya cruzado");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: persona,
          accion: "CUENTA_DE_IMAGEN_DECLARADA",
          entidad: "cuenta_de_imagen_declarada",
          entidadId: insertada.id,
          despues: { proveedor: insertada.proveedor, cuenta: insertada.cuenta },
        });
        return ok({ cuenta: insertada, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}
