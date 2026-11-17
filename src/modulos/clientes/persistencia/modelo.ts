import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { DocumentoDeParte } from "../dominio/documento";
import type { EstadoDeParte, NaturalezaDeParte } from "../dominio/estados";
import type { RolDeParte } from "../dominio/roles";
import type { TipoDeVinculo } from "../dominio/vinculos";

/** Lo que devuelven los repositorios del directorio: filas ya convertidas. Solo tipos; ninguna regla. */

export type DomicilioGuardado = Readonly<{
  pais: string;
  calle: string | null;
  numero: string | null;
  piso: string | null;
  departamento: string | null;
  localidad: string | null;
  provincia: string | null;
  codigoPostal: string | null;
  texto: string | null;
}>;

export type Parte = Readonly<{
  id: string;
  empresaId: EmpresaId;
  naturaleza: NaturalezaDeParte;
  /** `null` solo en una parte anonimizada. */
  nombre: string | null;
  apellido: string | null;
  alias: string | null;
  documento: DocumentoDeParte | null;
  documentoNormalizado: string | null;
  condicionIva: string | null;
  email: string | null;
  telefono: string | null;
  domicilio: DomicilioGuardado | null;
  nota: string | null;
  estado: EstadoDeParte;
  esAtajo: boolean;
  creadoPor: PersonaId | null;
  /** El valor de la columna generada `nombre_busqueda`. */
  nombreDeBusqueda: string;
  version: number;
}>;

export type RolGuardadoDeParte = Readonly<{ parteId: string; rol: RolDeParte; activo: boolean }>;

export type VinculoGuardado = Readonly<{
  parteId: string;
  deParteId: string;
  tipo: TipoDeVinculo;
  cargo: string | null;
  activo: boolean;
}>;
