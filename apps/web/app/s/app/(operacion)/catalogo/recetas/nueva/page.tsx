import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeEditarRecetas } from "../../../../../../../servidor/ofertas-de-stock";
import {
  cargarLosIngredientes,
  cargarLosProductosSinReceta,
} from "../../../../../../../servidor/recetas";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { leerElProductoDeLaDireccion } from "../../../../../../../ui/plantillas/recetas/filtros-de-recetas";
import {
  armarElFormulario,
  unidadesDelFormulario,
} from "../../../../../../../ui/plantillas/recetas/modelo-de-formulario-de-receta";
import { FormularioDeReceta } from "../../../../../../../ui/plantillas/recetas/FormularioDeReceta.cliente";
import { confirmarRecetaAccion, guardarRecetaAccion } from "../../../../acciones-de-recetas";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/catalogo/recetas/nueva`: la receta de un producto que todavía no tiene (maqueta `receta.html`, 15/11/2026). Acepta `?producto=<uuid>` (el de «Este producto no tiene receta») y lo deja elegido solo
// si es uno de los que se ofrecen. La página se ofrece solo a quien puede guardar (`composiciones.editar`: gerente y administrador); el servidor vuelve a decidirlo al guardar. Lo que se ofrece (los
// productos sin receta y los ingredientes) sale de la empresa del servidor: el navegador no nombra otra. La versión que se ve (0) y la unidad de cada ingrediente las liga la página a la acción.
export default async function PaginaDeLaRecetaNueva({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "receta.lista.nueva_receta" }, async ({ contexto }) => {
    if (!(await puedeEditarRecetas(contexto))) {
      return <ErrorDelDetalle error={errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")} />;
    }
    const productos = await cargarLosProductosSinReceta(contexto);
    if (!productos.ok) return <ErrorDelDetalle error={productos.error} />;
    const ingredientes = await cargarLosIngredientes(contexto, "");
    if (!ingredientes.ok) return <ErrorDelDetalle error={ingredientes.error} />;
    const formulario = armarElFormulario({
      producto: null,
      productos: productos.dato,
      productoElegido: leerElProductoDeLaDireccion(params),
      ingredientes: ingredientes.dato,
      rinde: "",
      pasos: null,
      lineas: [],
      version: 0,
    });
    const ligado = {
      productoId: null,
      versionEsperada: 0,
      unidades: unidadesDelFormulario(formulario),
    };
    return conTitulo(
      formulario.titulo,
      <FormularioDeReceta
        formulario={formulario}
        accion={guardarRecetaAccion.bind(null, ligado)}
        confirmar={confirmarRecetaAccion.bind(null, ligado)}
      />,
    );
  });
}
