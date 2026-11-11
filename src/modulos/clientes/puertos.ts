import type { ReglasDeEmpresa } from "../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../contexto/contexto";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { autorizar } from "./casos-de-uso/comun";
import type { TxDeClientes } from "./casos-de-uso/contrato";
import type { ErrorDeClientes } from "./casos-de-uso/errores";
import {
  crearParteDentro,
  type EntradaDeCrearParte,
  type SalidaDeCrearParte,
} from "./casos-de-uso/partes";
import { claveDeDocumento, entradaDeParte } from "./casos-de-uso/partes-comun";
import { validarDatosDeParte } from "./dominio/datos-de-parte";
import {
  documentoDeParteDesdeDatos,
  documentoNormalizado,
  type DatosDeDocumento,
  type DocumentoDeParte,
} from "./dominio/documento";
import type { NaturalezaDeParte } from "./dominio/estados";
import type { RolDeParte } from "./dominio/roles";
import { esUuid } from "./persistencia/filas";

/**
 * Los puertos que el directorio ofrece a otros módulos (E9 §3.11), para que compras, ventas y facturación lo usen sin tocar sus tablas. Corren en la
 * TRANSACCIÓN de quien los llama (`tx`): nunca abren la suya. El directorio no importa compras ni ningún otro módulo de negocio.
 */

/** Lo que otro módulo necesita de una parte para operar con ella (comprar, facturar). */
export type ParteParaOperacion = Readonly<{
  id: string;
  naturaleza: NaturalezaDeParte;
  nombre: string | null;
  apellido: string | null;
  alias: string | null;
  documento: DocumentoDeParte | null;
  condicionIva: string | null;
  version: number;
  roles: readonly RolDeParte[];
}>;

/** Cuatro códigos neutros: cada módulo los traduce al suyo (compras: `PROVEEDOR_NO_ENCONTRADO`). Una parte de otra empresa es `PARTE_NO_ENCONTRADA`. */
export type ErrorDeParteParaOperacion =
  "PARTE_NO_ENCONTRADA" | "PARTE_INACTIVA" | "PARTE_SIN_ROL" | "PARTE_ANONIMIZADA";

export interface DirectorioDePartes {
  /** La parte de la empresa, activa y con el rol que se exige, o el motivo por el que no sirve. */
  parteParaOperacion(
    tx: Pick<TxDeClientes, "partes">,
    empresa: EmpresaId,
    parteId: string,
    exigirRol: RolDeParte,
  ): Promise<Resultado<ParteParaOperacion, ErrorDeParteParaOperacion>>;
}

export function crearDirectorioDePartes(): DirectorioDePartes {
  return {
    async parteParaOperacion(tx, empresa, parteId, exigirRol) {
      if (!esUuid(parteId)) return err("PARTE_NO_ENCONTRADA");
      const parte = await tx.partes.obtener(empresa, parteId);
      if (parte === null) return err("PARTE_NO_ENCONTRADA");
      if (parte.estado === "ANONIMIZADA") return err("PARTE_ANONIMIZADA");
      if (parte.estado === "INACTIVA") return err("PARTE_INACTIVA");
      const roles = (await tx.partes.rolesDe(empresa, [parte.id]))
        .filter((r) => r.activo)
        .map((r) => r.rol);
      if (!roles.includes(exigirRol)) return err("PARTE_SIN_ROL");
      return ok({
        id: parte.id,
        naturaleza: parte.naturaleza,
        nombre: parte.nombre,
        apellido: parte.apellido,
        alias: parte.alias,
        documento: parte.documento,
        condicionIva: parte.condicionIva,
        version: parte.version,
        roles,
      });
    },
  };
}

export type EntradaDeCompletarDocumento = Readonly<{
  parteId: string;
  documento: DatosDeDocumento;
  condicionIva?: string | null | undefined;
  versionEsperada: number;
}>;
export type SalidaDeCompletarDocumento = Readonly<{ version: number; yaEstaba: boolean }>;
export type ErrorDeCompletarDocumento =
  | ErrorDeClientes
  /** La parte ya tiene un documento y es otro: no se pisa (S-14 de E9). */
  | "PARTE_CON_OTRO_DOCUMENTO";

export interface RegistroDePartes {
  /**
   * El alta de una parte dentro de la transacción de otro módulo (el proveedor nuevo desde la compra, D134). PERMISO COMPUESTO: quien llama ya exigió su
   * acción; acá se exige además `partes.crear` (no se crea una parte sin poder crearla). Misma repetición que `crearParte`.
   */
  crearEnTx(
    tx: TxDeClientes,
    contexto: ContextoOperativo,
    reglas: ReglasDeEmpresa,
    entrada: EntradaDeCrearParte,
  ): Promise<Resultado<SalidaDeCrearParte, ErrorDeClientes>>;
  /**
   * Guarda el documento (y, si viene, la condición frente al IVA) de una parte que no tenía (el CUIT pedido en la primera factura, D134). PERMISO COMPUESTO con
   * `partes.editar`. Si ya tiene ese mismo documento devuelve `yaEstaba`; si tiene otro, `PARTE_CON_OTRO_DOCUMENTO`: no se pisa. El documento ya usado por otra
   * parte da `DOCUMENTO_YA_REGISTRADO` con su id.
   */
  completarDocumentoEnTx(
    tx: TxDeClientes,
    contexto: ContextoOperativo,
    reglas: ReglasDeEmpresa,
    entrada: EntradaDeCompletarDocumento,
  ): Promise<Resultado<SalidaDeCompletarDocumento, ErrorDeCompletarDocumento>>;
}

export function crearRegistroDePartes(): RegistroDePartes {
  return {
    async crearEnTx(tx, contexto, reglas, entrada) {
      const permiso = await autorizar(tx, contexto, reglas, ["partes.crear"]);
      if (!permiso.ok) return permiso;
      return crearParteDentro(tx, contexto, entrada);
    },
    async completarDocumentoEnTx(tx, contexto, reglas, entrada) {
      const { empresaId } = contexto;
      const permiso = await autorizar(tx, contexto, reglas, ["partes.editar"]);
      if (!permiso.ok) return permiso;
      const actual = await tx.partes.bloquear(empresaId, entrada.parteId);
      if (actual === null) return err("PARTE_NO_ENCONTRADA");
      const documento = documentoDeParteDesdeDatos(actual.naturaleza, entrada.documento);
      if (!documento.ok) {
        return err({
          error: "DATOS_INVALIDOS",
          campos: [{ campo: "documento", codigo: documento.error }],
        });
      }
      if (actual.documentoNormalizado !== null) {
        return actual.documentoNormalizado === documentoNormalizado(documento.valor)
          ? ok({ version: actual.version, yaEstaba: true })
          : err("PARTE_CON_OTRO_DOCUMENTO");
      }
      const datos = validarDatosDeParte({
        ...entradaDeParte(actual),
        documento: entrada.documento,
        ...(entrada.condicionIva === undefined ? {} : { condicionIva: entrada.condicionIva }),
      });
      if (!datos.ok) return err({ error: "DATOS_INVALIDOS", campos: datos.error });
      if (entrada.versionEsperada !== actual.version) return err("VERSION_DESACTUALIZADA");
      const ocupado = await tx.partes.porDocumento(empresaId, claveDeDocumento(datos.valor) ?? "");
      if (ocupado !== null && ocupado.id !== actual.id) {
        return err(
          ocupado.estado === "ACTIVA"
            ? { error: "DOCUMENTO_YA_REGISTRADO", parteId: ocupado.id }
            : { error: "PARTE_INACTIVA_CON_ESE_DOCUMENTO", parteId: ocupado.id },
        );
      }
      const editada = await tx.partes.actualizar(empresaId, actual.id, actual.version, datos.valor);
      if (editada === null) return err("VERSION_DESACTUALIZADA");
      await tx.auditoria.registrar({
        empresaId,
        actorPersonaId: contexto.personaId,
        accion: "PARTE_EDITADA",
        entidad: "parte",
        entidadId: actual.id,
        despues: {
          campos: ["documento", ...(entrada.condicionIva === undefined ? [] : ["condicionIva"])],
        },
      });
      return ok({ version: editada.version, yaEstaba: false });
    },
  };
}
