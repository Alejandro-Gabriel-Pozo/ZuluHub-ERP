import { redirect } from "next/navigation";
import { rutaDeRetorno } from "../../../../../../../src/capacidades/experiencia/ruta-de-retorno";
import { PantallaDeIngreso } from "../../../../../ui/plantillas/sesion/PantallaDeIngreso";
import { sesionDelPedido } from "../../../../../servidor/sesion";
import { ingresarConGoogleAccion } from "../../acciones";

type Consulta = Promise<Record<string, string | string[] | undefined>>;

/** El primer valor de un parámetro de la dirección (puede venir repetido o faltar). */
const unico = (valor: string | string[] | undefined): string | null =>
  (Array.isArray(valor) ? valor[0] : valor) ?? null;

// `/ingreso`: «Ingresar con Google». Con sesión vigente en ESTE host no hay nada que hacer acá: sigue a donde iba.
export default async function PaginaDeIngreso({ searchParams }: { searchParams: Consulta }) {
  const consulta = await searchParams;
  const volver = rutaDeRetorno(unico(consulta["volver"]));
  const { puerta, sesion } = await sesionDelPedido();
  if (sesion !== null) redirect(volver);
  return (
    <PantallaDeIngreso
      marca={puerta.marca.nombre}
      accion={ingresarConGoogleAccion}
      volver={volver}
      codigoDeError={unico(consulta["error"])}
    />
  );
}
