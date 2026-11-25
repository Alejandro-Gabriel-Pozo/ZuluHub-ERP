import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarElNivelDeCompras } from "../../../../../../servidor/nivel-de-compras";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeNivelDeCompras } from "../../../../../../ui/plantillas/compras/nivel/FormularioDeNivelDeCompras.cliente";
import { textosDeNivelDeCompras } from "../../../../../../ui/plantillas/compras/nivel/textos-de-nivel-de-compras";
import { guardarNivelDeComprasAccion } from "../../../acciones-de-nivel-de-compras";

// `/compras/nivel`: «Nivel de compras» (maqueta `compra-nivel.html`): un selector y «Guardar». Solo el gerente (`compras.configurar`): para los demás la lectura rechaza y se ve el genérico, sin
// distinguir el motivo. No lleva nada de la dirección: la empresa y la persona los decide el servidor. La versión que se vio la lleva el formulario y el servidor la compara al guardar.
export default async function PaginaDelNivelDeCompras() {
  return pantallaDeOperacion({ titulo: "compras.nivel.titulo" }, async ({ contexto }) => {
    const nivel = await cargarElNivelDeCompras(contexto);
    if (!nivel.ok) return <ErrorDelDetalle error={nivel.error} />;
    return (
      <FormularioDeNivelDeCompras
        inicial={nivel.dato}
        accion={guardarNivelDeComprasAccion}
        textos={textosDeNivelDeCompras()}
      />
    );
  });
}
