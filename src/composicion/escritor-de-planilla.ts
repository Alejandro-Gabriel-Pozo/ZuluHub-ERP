import { crearEscritorDeXlsx } from "../adaptadores/xlsx/escritor-de-xlsx";
import type { EscritorDePlanilla } from "../puertos/escritor-de-planilla";

/** El escritor de planillas de la aplicación: el adaptador `.xlsx`. Es la única puerta de la web al escritor (las rutas no importan adaptadores). */
export const crearEscritorDePlanilla = (): EscritorDePlanilla => crearEscritorDeXlsx();
