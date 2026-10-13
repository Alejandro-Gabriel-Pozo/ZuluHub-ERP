import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContenedorDeLetra } from "../../../../../ui/plantillas/carta/ContenedorDeLetra.cliente";
import { PaginaDeProducto } from "../../../../../ui/plantillas/carta/PaginaDeProducto";
import { productoParaLaPantalla } from "../../../../../servidor/carta";

type Props = Readonly<{ params: Promise<{ codigo: string; producto: string }> }>;

// "{producto} · {carta}" (§8). Siempre `noindex`: decenas de páginas casi iguales a la carta no se indexan.
// La descripción y la imagen social las trae C-3 con `metadatosDePagina`; acá no se inventa ninguna.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo, producto } = await params;
  const datos = await productoParaLaPantalla(codigo, producto);
  return datos === null
    ? { robots: { index: false, follow: false } }
    : {
        title: `${datos.producto.nombre} · ${datos.vista.nombre}`,
        robots: { index: false, follow: false },
      };
}

export default async function PaginaDelProducto({ params }: Props) {
  const { codigo, producto } = await params;
  const datos = await productoParaLaPantalla(codigo, producto);
  if (datos === null) notFound();
  const { vista, textos } = datos;
  return (
    <ContenedorDeLetra letraBase={vista.letraBase}>
      <PaginaDeProducto
        producto={datos.producto}
        carta={vista.nombre}
        hrefDeLaCarta={`${vista.hrefDeLaCarta}#${datos.producto.seccion}`}
        textos={textos}
      />
    </ContenedorDeLetra>
  );
}
