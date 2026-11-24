import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDeUsuario } from "../../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaFichaDeUsuario } from "../../../../../../../ui/plantillas/usuarios/modelo-de-usuarios";
import { PantallaDeFichaDeUsuario } from "../../../../../../../ui/plantillas/usuarios/PantallaDeFichaDeUsuario";

// `/cuenta/usuarios/[personaId]` (tramo U1, solo lectura): la ficha de una persona de la empresa. El id es lo único que viene de la dirección: la empresa y quien mira salen de la sesión, y el servidor lo
// busca entre las personas de ESA empresa. Un id mal escrito, de otra empresa o inexistente sale igual (el genérico): no se distingue. Sin botones: los suman los tramos que desactivan y asignan sucursales.
export default async function PaginaDeFichaDeUsuario({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const { personaId } = await params;
  return pantallaDeOperacion({ titulo: "usuarios.lista.titulo" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeUsuario(contexto, personaId);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const armada = armarLaFichaDeUsuario(ficha.dato);
    return conTitulo(armada.email, <PantallaDeFichaDeUsuario ficha={armada} />);
  });
}
