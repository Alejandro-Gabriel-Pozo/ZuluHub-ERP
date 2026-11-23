import type { CadenasDeConfianza } from "../adaptadores/certificados/lector-x509";
import type { ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import type { ProveedorDeEmision } from "../modulos/fiscal/publico";
import type { Conexiones } from "./conexiones";

/**
 * Lo que `armarWeb` resuelve UNA vez (valores por defecto incluidos) y le pasa a cada parte `web-de-<carpeta>.ts`. Ninguna parte
 * recalcula un valor por defecto y ninguna importa otra parte: lo que comparten entra por acá.
 */
export type BaseDeWeb = Readonly<{
  conexiones: Conexiones;
  reglas: ReglasDeEmpresa;
  reloj: Readonly<{ ahora(): Date }>;
  emision: ProveedorDeEmision;
  cadenasDeConfianza: CadenasDeConfianza;
}>;
