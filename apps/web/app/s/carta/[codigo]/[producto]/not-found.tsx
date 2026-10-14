import { textosPorDefectoDeLaCarta } from "../../../../../servidor/carta";
import { PaginaDeProductoQueYaNoEsta } from "../../../../../ui/plantillas/carta/PaginaDeProducto";

// Producto que ya no está (o carta que no existe: la misma pantalla, así no hay forma de distinguirlos).
// `./` es la carta en las dos formas de la dirección: `/<código>/<producto>` y, en host dedicado, `/<producto>`.
export default function ProductoQueYaNoEsta() {
  return <PaginaDeProductoQueYaNoEsta hrefDeLaCarta="./" textos={textosPorDefectoDeLaCarta()} />;
}
