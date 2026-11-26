import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import {
  accionesDeLasNotas,
  cargarLasNotasDeLaFactura,
} from "../../../../../../../../servidor/notas";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeNotas } from "../../../../../../../../ui/plantillas/compras/notas/PantallaDeNotas";
import { armarLaPantallaDeNotas } from "../../../../../../../../ui/plantillas/compras/notas/modelo-de-notas";
import { textosDeNotas } from "../../../../../../../../ui/plantillas/compras/notas/textos-de-notas";
import {
  anularNotaDeCreditoAccion,
  anularNotaDeDebitoAccion,
} from "../../../../../acciones-de-notas";

// `/compras/facturas/[id]/notas`: «Notas de la factura» (maqueta `servicios-y-bienes-de-uso.html`, pantalla 9). El id es lo único que viene de la dirección: la empresa, la persona y el alcance los decide el servidor. Una factura
// que no existe, de otra empresa o fuera del alcance sale igual (el genérico). Sin permiso para ver las notas (crédito y débito) la lectura se rechaza y no hay pantalla. Los botones se ofrecen con el permiso de cada acción y
// el servidor los vuelve a verificar al actuar; la factura, la nota y su clase las liga la página con `.bind`.
export default async function PaginaDeLasNotas({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.notas.titulo" }, async ({ contexto }) => {
    const notas = await cargarLasNotasDeLaFactura(contexto, id);
    if (!notas.ok) return <ErrorDelDetalle error={notas.error} />;
    const textos = textosDeNotas();
    const pantalla = armarLaPantallaDeNotas(notas.dato, textos, await accionesDeLasNotas(contexto));
    return conTitulo(
      pantalla.titulo,
      <PantallaDeNotas
        pantalla={pantalla}
        textos={textos}
        accionesDeAnular={Object.fromEntries(
          pantalla.filas.map((f) => [
            f.id,
            (f.clase === "NOTA_DE_CREDITO"
              ? anularNotaDeCreditoAccion
              : anularNotaDeDebitoAccion
            ).bind(null, notas.dato.facturaId, f.id),
          ]),
        )}
      />,
    );
  });
}
