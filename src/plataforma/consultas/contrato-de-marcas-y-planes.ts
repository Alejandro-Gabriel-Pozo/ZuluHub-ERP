import type { ReglasDePlataforma } from "../../capacidades/permisos/plataforma";
import type { Transacciones } from "../../puertos/transacciones";
import type {
  CatalogoDeModulosParaPlanes,
  CatalogoDePerillasParaPlanes,
  TxDeMarcasYPlanes,
} from "../casos-de-uso/marcas-y-planes-comun";

/**
 * Lo que una consulta de plataforma sobre marcas y planes recibe de su transacción (M5): el guard y los
 * repositorios, para LEER. Es un recorte de lo que recibe un caso de uso (`TxDeMarcasYPlanes`): la misma
 * transacción armada por la composición les sirve a ambos, pero una consulta no puede escribir, auditar ni
 * tocar claves de idempotencia (no las tiene en el tipo).
 */
export type TxDeConsultasDeMarcasYPlanes = Pick<
  TxDeMarcasYPlanes,
  "autorizacionDePlataforma" | "marcas" | "planes" | "derechos"
>;

export type DependenciasDeConsultasDeMarcasYPlanes = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeMarcasYPlanes>;
  /** El catálogo y la matriz de PLATAFORMA con los que se autoriza a quien consulta. */
  reglas: ReglasDePlataforma;
  catalogoDeModulos: CatalogoDeModulosParaPlanes;
  catalogoDePerillas: CatalogoDePerillasParaPlanes;
}>;
