import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarRecetas } from "../../../../../../../../servidor/ofertas-de-stock";
import { cargarLaReceta, cargarLosIngredientes } from "../../../../../../../../servidor/recetas";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarElFormulario,
  unidadesDelFormulario,
} from "../../../../../../../../ui/plantillas/recetas/modelo-de-formulario-de-receta";
import { FormularioDeReceta } from "../../../../../../../../ui/plantillas/recetas/FormularioDeReceta.cliente";
import { confirmarRecetaAccion, guardarRecetaAccion } from "../../../../../acciones-de-recetas";

type PropsDePagina = Readonly<{ params: Promise<{ productoId: string }> }>;

// `/catalogo/recetas/[productoId]/editar`: editar la receta vigente de un producto; guardar crea una versión NUEVA y nada se pisa (maqueta `receta.html`, 15/11/2026). El id de la dirección es lo
// único que viene del navegador: un producto que no es de la empresa, no tiene receta o está mal escrito sale como el genérico. La acción lleva la última versión que se vio (si otra persona guardó
// antes, el servidor rechaza sin escribir) y la unidad de cada ingrediente. Solo se ofrece a quien puede guardar (`composiciones.editar`); el servidor vuelve a decidirlo al guardar.
export default async function PaginaDeEditarLaReceta({ params }: PropsDePagina) {
  const { productoId } = await params;
  return pantallaDeOperacion({ titulo: "receta.pantalla.recetas" }, async ({ contexto }) => {
    if (!(await puedeEditarRecetas(contexto))) {
      return <ErrorDelDetalle error={errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")} />;
    }
    const receta = await cargarLaReceta(contexto, productoId);
    if (!receta.ok) return <ErrorDelDetalle error={receta.error} />;
    if (receta.dato === null || receta.dato.ficha === null) {
      return <ErrorDelDetalle error={errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")} />;
    }
    const ingredientes = await cargarLosIngredientes(contexto, productoId);
    if (!ingredientes.ok) return <ErrorDelDetalle error={ingredientes.error} />;
    const { producto, ficha, ultimaVersion } = receta.dato;
    const formulario = armarElFormulario({
      producto: { id: producto.id, nombre: producto.nombre },
      productos: [],
      productoElegido: "",
      ingredientes: ingredientes.dato,
      rinde: ficha.rinde,
      pasos: ficha.pasos,
      lineas: ficha.componentes.map((c) => ({
        ingredienteId: c.productoId,
        nombre: c.nombre,
        unidadId: c.unidadId,
        bruto: c.bruto,
        merma: c.merma,
      })),
      version: ultimaVersion,
    });
    const ligado = {
      productoId: producto.id,
      versionEsperada: ultimaVersion,
      unidades: unidadesDelFormulario(formulario),
    };
    return conTitulo(
      formulario.titulo,
      <FormularioDeReceta
        key={`${producto.id}-${String(ultimaVersion)}`}
        formulario={formulario}
        accion={guardarRecetaAccion.bind(null, ligado)}
        confirmar={confirmarRecetaAccion.bind(null, ligado)}
      />,
    );
  });
}
