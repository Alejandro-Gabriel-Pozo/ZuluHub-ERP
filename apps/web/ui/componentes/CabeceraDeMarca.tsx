import estilos from "./CabeceraDeMarca.module.css";

export type PropsDeCabeceraDeMarca = Readonly<{
  /** El nombre visible de la marca, ya resuelto. Se pinta como texto, nunca como marcado. */
  nombre: string;
}>;

/** La cabecera de una superficie con marca: el nombre sobre el color primario (contraste validado). */
export function CabeceraDeMarca({ nombre }: PropsDeCabeceraDeMarca) {
  return (
    <header className={estilos["raiz"]}>
      <p className={estilos["nombre"]}>{nombre}</p>
    </header>
  );
}
