import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { crearDirectorioDePartes, type TxDeClientes } from "../../clientes/publico";
import type { DatosDelCliente } from "../antiguedad";

const directorio = crearDirectorioDePartes();

/**
 * El nombre para mostrar y el CUIT de varios clientes de la empresa, en dos lecturas (sin una consulta por cliente). Un cliente anonimizado, de otra empresa o inexistente sale con nombre y
 * CUIT `null`: nunca un dato inventado ni de otra empresa. Solo el documento de tipo CUIT cuenta como CUIT (un CUIL o un DNI no lo es).
 */
export async function datosDeLosClientes(
  tx: Pick<TxDeClientes, "partes">,
  empresa: EmpresaId,
  parteIds: readonly string[],
): Promise<Map<string, DatosDelCliente>> {
  const unicos = [...new Set(parteIds)];
  const nombres = await directorio.nombresParaMostrar(tx, empresa, unicos);
  const partes = await tx.partes.obtenerVarias(empresa, unicos);
  const cuits = new Map(
    partes.map((p) => [
      p.id,
      p.estado !== "ANONIMIZADA" && p.documento?.tipo === "CUIT" ? p.documento.numero : null,
    ]),
  );
  return new Map(
    unicos.map((id) => [id, { nombre: nombres.get(id) ?? null, cuit: cuits.get(id) ?? null }]),
  );
}
