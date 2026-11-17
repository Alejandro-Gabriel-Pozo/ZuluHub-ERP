import type { Selectable } from "kysely";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import { esTipoDeDocumentoDeParte, type DocumentoDeParte } from "../dominio/documento";
import { esNaturalezaDeParte, ESTADOS_DE_PARTE, type EstadoDeParte } from "../dominio/estados";
import { esRolDeParte } from "../dominio/roles";
import { esTipoDeVinculo } from "../dominio/vinculos";
import type { ClientesDb } from "./esquema";
import type { Parte, RolGuardadoDeParte, VinculoGuardado } from "./modelo";

/** Un texto que no es un UUID no puede ser el id de nada: la base lo rechazaría por formato en lugar de decir «no existe». */
export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

function estadoGuardado(texto: string): EstadoDeParte {
  const estado = ESTADOS_DE_PARTE.find((e) => e === texto);
  if (estado === undefined) throw new RangeError(`estado de parte desconocido: ${texto}`);
  return estado;
}

function documentoGuardado(tipo: string, pais: string | null, numero: string): DocumentoDeParte {
  if (!esTipoDeDocumentoDeParte(tipo)) {
    throw new RangeError(`tipo de documento desconocido: ${tipo}`);
  }
  if (tipo === "PASAPORTE" || tipo === "ID_EXTRANJERO") {
    if (pais === null) throw new RangeError(`documento ${tipo} sin país`);
    return { tipo, pais, numero };
  }
  return { tipo, pais: null, numero };
}

export function aParte(fila: Selectable<ClientesDb["parte"]>): Parte {
  if (!esNaturalezaDeParte(fila.naturaleza)) {
    throw new RangeError(`naturaleza de parte desconocida: ${fila.naturaleza}`);
  }
  const documento =
    fila.documento_tipo === null || fila.documento_numero === null
      ? null
      : documentoGuardado(fila.documento_tipo, fila.documento_pais, fila.documento_numero);
  return {
    id: fila.id,
    empresaId: empresaId(fila.empresa_id),
    naturaleza: fila.naturaleza,
    nombre: fila.nombre,
    apellido: fila.apellido,
    alias: fila.alias,
    documento,
    documentoNormalizado: fila.documento_normalizado,
    condicionIva: fila.condicion_iva,
    email: fila.email,
    telefono: fila.telefono,
    domicilio:
      fila.dom_pais === null
        ? null
        : {
            pais: fila.dom_pais,
            calle: fila.dom_calle,
            numero: fila.dom_numero,
            piso: fila.dom_piso,
            departamento: fila.dom_departamento,
            localidad: fila.dom_localidad,
            provincia: fila.dom_provincia,
            codigoPostal: fila.dom_codigo_postal,
            texto: fila.dom_texto,
          },
    nota: fila.nota,
    estado: estadoGuardado(fila.estado),
    esAtajo: fila.es_atajo,
    creadoPor: fila.creado_por === null ? null : personaId(fila.creado_por),
    nombreDeBusqueda: fila.nombre_busqueda,
    version: fila.version,
  };
}

export function aRol(fila: Selectable<ClientesDb["parte_rol"]>): RolGuardadoDeParte {
  if (!esRolDeParte(fila.rol)) throw new RangeError(`rol de parte desconocido: ${fila.rol}`);
  return { parteId: fila.parte_id, rol: fila.rol, activo: fila.activo };
}

export function aVinculo(fila: Selectable<ClientesDb["parte_vinculo"]>): VinculoGuardado {
  if (!esTipoDeVinculo(fila.tipo))
    throw new RangeError(`tipo de vínculo desconocido: ${fila.tipo}`);
  return {
    parteId: fila.parte_id,
    deParteId: fila.de_parte_id,
    tipo: fila.tipo,
    cargo: fila.cargo,
    activo: fila.activo,
  };
}
