import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { DatosDeParte } from "../dominio/datos-de-parte";
import type { EstadoDeParte } from "../dominio/estados";
import type { RolDeParte } from "../dominio/roles";
import type { TipoDeVinculo } from "../dominio/vinculos";
import { normalizarParaBusqueda, nombreCompletoDeParte } from "../dominio/busqueda";
import { digitosDeTelefono } from "../dominio/duplicados";
import type { ClientesDb } from "./esquema";
import { aParte, aRol, aVinculo, esUuid } from "./filas";
import type { Parte, RolGuardadoDeParte, VinculoGuardado } from "./modelo";

export type AltaDeParte = Readonly<{
  /** La manda la pantalla: es la idempotencia del alta. */
  idempotencia: string;
  datos: DatosDeParte;
  esAtajo: boolean;
  creadoPor: PersonaId;
}>;

/** Las columnas que escribe un alta o un cambio de datos (las que la base no calcula). */
function columnasDeDatos(datos: DatosDeParte) {
  const d = datos.domicilio;
  return {
    naturaleza: datos.naturaleza,
    nombre: datos.nombre,
    apellido: datos.apellido,
    alias: datos.alias,
    documento_tipo: datos.documento?.tipo ?? null,
    documento_pais: datos.documento?.pais ?? null,
    documento_numero: datos.documento?.numero ?? null,
    condicion_iva: datos.condicionIva,
    email: datos.email,
    telefono: datos.telefono,
    dom_pais: d === null ? null : d.pais,
    dom_calle: d !== null && "estructurado" in d ? d.estructurado.calle : null,
    dom_numero: d !== null && "estructurado" in d ? d.estructurado.numero : null,
    dom_piso: d !== null && "estructurado" in d ? d.estructurado.piso : null,
    dom_departamento: d !== null && "estructurado" in d ? d.estructurado.departamento : null,
    dom_localidad: d !== null && "estructurado" in d ? d.estructurado.localidad : null,
    dom_provincia: d !== null && "estructurado" in d ? d.estructurado.provincia : null,
    dom_codigo_postal: d !== null && "estructurado" in d ? d.estructurado.codigoPostal : null,
    dom_texto: d !== null && "texto" in d ? d.texto : null,
    nota: datos.nota,
  };
}

export type FiltroDeCandidatos = Readonly<{
  /** El texto buscado, ya normalizado (`normalizarParaBusqueda`); vacío: no se busca por nombre. */
  textoNormalizado: string;
  /** El documento buscado en la forma de `documento_normalizado`, o `null` si lo escrito no parece un documento. */
  documentoBuscado: string | null;
  rol: RolDeParte | null;
  incluirDesactivadas: boolean;
}>;

/** Cuántos candidatos como máximo trae una búsqueda antes de que el dominio los ordene (la lista se pide por prefijo, no se recorre entera). */
export const TOPE_DE_CANDIDATOS_DE_BUSQUEDA = 500;

export type DatosParaBuscarDuplicados = Readonly<{
  email: string | null;
  telefonoDigitos: string | null;
  nombreNormalizado: string;
}>;

export interface RepositorioDePartes {
  obtener(empresa: EmpresaId, id: string): Promise<Parte | null>;
  /** La parte con `SELECT … FOR UPDATE`: serializa editar, desactivar y cambiar roles de la misma parte. `null` si no existe o es de otra empresa. */
  bloquear(empresa: EmpresaId, id: string): Promise<Parte | null>;
  porIdempotencia(empresa: EmpresaId, idempotencia: string): Promise<Parte | null>;
  /** La parte de la empresa con ese documento (activa o no), o `null`. */
  porDocumento(empresa: EmpresaId, normalizado: string): Promise<Parte | null>;
  /**
   * `INSERT … ON CONFLICT DO NOTHING`: el id si insertó, `null` si alguna única ya estaba ocupada (la idempotencia del alta o el documento): el caso de uso
   * busca cuál con `porIdempotencia` y `porDocumento`.
   */
  insertar(empresa: EmpresaId, alta: AltaDeParte): Promise<string | null>;
  /** Cambia los datos con control de versión (la base la sube); `null` si la versión ya no es esa. */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    datos: DatosDeParte,
  ): Promise<Parte | null>;
  cambiarEstado(empresa: EmpresaId, id: string, estado: EstadoDeParte): Promise<Parte | null>;
  /** Las partes que coinciden con lo buscado, sin ordenar (hasta `TOPE_DE_CANDIDATOS_DE_BUSQUEDA`), por nombre de búsqueda e id. */
  candidatos(empresa: EmpresaId, filtro: FiltroDeCandidatos): Promise<Parte[]>;
  /** Las partes que comparten el email, los dígitos del teléfono o el nombre de búsqueda con lo dado (sin la propia). */
  posiblesDuplicados(
    empresa: EmpresaId,
    buscados: DatosParaBuscarDuplicados,
    excluirId: string | null,
  ): Promise<Parte[]>;
  /** Los roles guardados (activos o no) de varias partes. */
  rolesDe(empresa: EmpresaId, partes: readonly string[]): Promise<RolGuardadoDeParte[]>;
  insertarRol(empresa: EmpresaId, parteId: string, rol: RolDeParte): Promise<void>;
  cambiarActivoDeRol(
    empresa: EmpresaId,
    parteId: string,
    rol: RolDeParte,
    activo: boolean,
  ): Promise<void>;
  vinculo(
    empresa: EmpresaId,
    parteId: string,
    deParteId: string,
    tipo: TipoDeVinculo,
  ): Promise<VinculoGuardado | null>;
  insertarVinculo(
    empresa: EmpresaId,
    vinculo: Readonly<{
      parteId: string;
      deParteId: string;
      tipo: TipoDeVinculo;
      cargo: string | null;
    }>,
  ): Promise<void>;
  actualizarVinculo(
    empresa: EmpresaId,
    clave: Readonly<{ parteId: string; deParteId: string; tipo: TipoDeVinculo }>,
    cambios: Readonly<{ activo: boolean; cargo: string | null }>,
  ): Promise<void>;
  /** Los vínculos activos en los que la parte es contacto o es la empresa de la que lo son. */
  vinculosDe(empresa: EmpresaId, parteId: string): Promise<VinculoGuardado[]>;
}

export function crearRepositorioDePartes(db: Kysely<ClientesDb>): RepositorioDePartes {
  const partes = () => db.selectFrom("parte").selectAll();
  return {
    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await partes()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async bloquear(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await partes()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async porIdempotencia(empresa, idempotencia) {
      const fila = await partes()
        .where("empresa_id", "=", empresa)
        .where("idempotencia_alta", "=", idempotencia)
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async porDocumento(empresa, normalizado) {
      const fila = await partes()
        .where("empresa_id", "=", empresa)
        .where("documento_normalizado", "=", normalizado)
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async insertar(empresa, alta) {
      // Sin objetivo de conflicto: cualquier única violada (la idempotencia del alta o el documento) devuelve `null` y el caso de uso mira cuál fue.
      // Así la parte que perdió una carrera por el documento puede decir CON QUIÉN choca (una excepción dejaría la transacción abortada).
      const fila = await db
        .insertInto("parte")
        .values({
          empresa_id: empresa,
          idempotencia_alta: alta.idempotencia,
          es_atajo: alta.esAtajo,
          creado_por: alta.creadoPor,
          ...columnasDeDatos(alta.datos),
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila === undefined ? null : fila.id;
    },
    async actualizar(empresa, id, versionEsperada, datos) {
      const fila = await db
        .updateTable("parte")
        .set(columnasDeDatos(datos))
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async cambiarEstado(empresa, id, estado) {
      const fila = await db
        .updateTable("parte")
        .set({ estado })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aParte(fila);
    },
    async candidatos(empresa, filtro) {
      const patron = `%${escaparParaLike(filtro.textoNormalizado)}%`;
      let consulta = partes()
        .where("empresa_id", "=", empresa)
        .where("estado", "<>", "ANONIMIZADA");
      if (!filtro.incluirDesactivadas) consulta = consulta.where("estado", "=", "ACTIVA");
      const documento = filtro.documentoBuscado;
      consulta = consulta.where((eb) => {
        const porNombre =
          filtro.textoNormalizado === ""
            ? null
            : sql<boolean>`${eb.ref("nombre_busqueda")} like ${patron} escape '\\'`;
        const porDocumento =
          documento === null ? null : eb("documento_normalizado", "=", documento);
        const alguna = [porNombre, porDocumento].filter((c) => c !== null);
        // Sin lo que buscar por nombre ni por documento: la lista completa (lo que devuelve «Todos» con la búsqueda vacía).
        return alguna.length === 0 ? sql<boolean>`true` : eb.or(alguna);
      });
      if (filtro.rol !== null) {
        const rol = filtro.rol;
        consulta = consulta.where((eb) =>
          eb.exists(
            eb
              .selectFrom("parte_rol")
              .select(sql<number>`1`.as("uno"))
              .whereRef("parte_rol.parte_id", "=", "parte.id")
              .whereRef("parte_rol.empresa_id", "=", "parte.empresa_id")
              .where("parte_rol.rol", "=", rol)
              .where("parte_rol.activo", "=", true),
          ),
        );
      }
      const filas = await consulta
        .orderBy("nombre_busqueda")
        .orderBy("id")
        .limit(TOPE_DE_CANDIDATOS_DE_BUSQUEDA)
        .execute();
      return filas.map(aParte);
    },
    async posiblesDuplicados(empresa, buscados, excluirId) {
      let consulta = partes()
        .where("empresa_id", "=", empresa)
        .where("estado", "<>", "ANONIMIZADA");
      if (excluirId !== null) consulta = consulta.where("id", "<>", excluirId);
      consulta = consulta.where((eb) => {
        const condiciones = [];
        if (buscados.email !== null) condiciones.push(eb("email", "=", buscados.email));
        if (buscados.telefonoDigitos !== null) {
          condiciones.push(eb("telefono_digitos", "=", buscados.telefonoDigitos));
        }
        if (buscados.nombreNormalizado !== "") {
          condiciones.push(eb("nombre_busqueda", "=", buscados.nombreNormalizado));
        }
        return condiciones.length === 0 ? sql<boolean>`false` : eb.or(condiciones);
      });
      const filas = await consulta.orderBy("nombre_busqueda").orderBy("id").limit(20).execute();
      return filas.map(aParte);
    },
    async rolesDe(empresa, ids) {
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("parte_rol")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("parte_id", "in", [...ids])
        .orderBy("parte_id")
        .orderBy("rol")
        .execute();
      return filas.map(aRol);
    },
    async insertarRol(empresa, parteId, rol) {
      await db
        .insertInto("parte_rol")
        .values({ empresa_id: empresa, parte_id: parteId, rol })
        .execute();
    },
    async cambiarActivoDeRol(empresa, parteId, rol, activo) {
      await db
        .updateTable("parte_rol")
        .set({ activo })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("rol", "=", rol)
        .execute();
    },
    async vinculo(empresa, parteId, deParteId, tipo) {
      const fila = await db
        .selectFrom("parte_vinculo")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", parteId)
        .where("de_parte_id", "=", deParteId)
        .where("tipo", "=", tipo)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aVinculo(fila);
    },
    async insertarVinculo(empresa, vinculo) {
      await db
        .insertInto("parte_vinculo")
        .values({
          empresa_id: empresa,
          parte_id: vinculo.parteId,
          de_parte_id: vinculo.deParteId,
          tipo: vinculo.tipo,
          cargo: vinculo.cargo,
        })
        .execute();
    },
    async actualizarVinculo(empresa, clave, cambios) {
      await db
        .updateTable("parte_vinculo")
        .set({ activo: cambios.activo, cargo: cambios.cargo })
        .where("empresa_id", "=", empresa)
        .where("parte_id", "=", clave.parteId)
        .where("de_parte_id", "=", clave.deParteId)
        .where("tipo", "=", clave.tipo)
        .execute();
    },
    async vinculosDe(empresa, parteId) {
      const filas = await db
        .selectFrom("parte_vinculo")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .where((eb) => eb.or([eb("parte_id", "=", parteId), eb("de_parte_id", "=", parteId)]))
        .orderBy("de_parte_id")
        .orderBy("parte_id")
        .orderBy("tipo")
        .execute();
      return filas.map(aVinculo);
    },
  };
}

/** Escapa lo que `LIKE` toma como comodín (`%`, `_`) y la propia barra, para buscar el texto tal cual. */
export function escaparParaLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Lo que busca `posiblesDuplicados` para una parte con estos datos. */
export function buscadosDeDuplicado(datos: DatosDeParte): DatosParaBuscarDuplicados {
  return {
    email: datos.email,
    telefonoDigitos: digitosDeTelefono(datos.telefono),
    nombreNormalizado: normalizarParaBusqueda(nombreCompletoDeParte(datos)),
  };
}
