import { Aviso } from "../../web/ui/componentes/Aviso";
import { EnlaceDeAccion } from "../../web/ui/componentes/EnlaceDeAccion";
import { Insignia } from "../../web/ui/componentes/Insignia";
import { SoloLector } from "../../web/ui/primitivas/SoloLector";
import { Texto } from "../../web/ui/primitivas/Texto";
import { rotuloDeModulo } from "../logica/plan";
import type { PermisosDePlanes } from "../logica/permisos-de-planes";
import { textoDePlanes } from "../logica/textos-de-planes";
import type { FichaVista, VersionVista } from "../logica/vista-de-planes";
import estilos from "./empresas.module.css";
import propios from "./planes.module.css";

export type AvisoDeFicha = "creado" | "existia" | "publicada" | null;

const nombresDe = (claves: readonly string[]): string =>
  claves.length === 0 ? "—" : claves.map(rotuloDeModulo).join(", ");

/** Los módulos de una versión sin los obligatorios que figuran en todas: se muestran todos (lo que el plan incluye de verdad). */
function FilaDeVersion({ plan, v }: Readonly<{ plan: string; v: VersionVista }>) {
  return (
    <tr>
      <th scope="row" className={estilos["nombre"]}>
        {v.borrador ? (
          <a
            className={estilos["enlaceSimple"]}
            href={`/planes/${encodeURIComponent(plan)}/borrador`}
          >
            {textoDePlanes("plataforma.planes.version_borrador")}
          </a>
        ) : (
          <a
            className={estilos["enlaceSimple"]}
            href={`/planes/${encodeURIComponent(plan)}/version/${encodeURIComponent(v.id)}`}
          >
            v{v.numero}
          </a>
        )}
      </th>
      <td>
        <span className={estilos["rotulo"]}>{textoDePlanes("plataforma.planes.col_estado")}</span>
        <span>
          <Insignia tono={v.borrador ? "aviso" : "exito"}>
            {textoDePlanes(
              v.borrador
                ? "plataforma.planes.version_borrador"
                : "plataforma.planes.version_publicada",
            )}
          </Insignia>
        </span>
      </td>
      <td>
        <span className={estilos["rotulo"]}>
          {textoDePlanes("plataforma.planes.nombre_comercial")}
        </span>
        <span>{v.nombreComercial}</span>
      </td>
      <td>
        <span className={estilos["rotulo"]}>{textoDePlanes("plataforma.planes.modulos")}</span>
        <span>{nombresDe(v.modulos)}</span>
      </td>
      <td>
        <span className={estilos["rotulo"]}>
          {textoDePlanes("plataforma.planes.col_clientes_version")}
        </span>
        <span>{v.clientes}</span>
      </td>
      <td>
        <span className={estilos["rotulo"]}>
          {textoDePlanes("plataforma.planes.version_publicada")}
        </span>
        <span>{v.publicadaEn ?? "—"}</span>
      </td>
    </tr>
  );
}

/** La ficha de un plan: sus versiones (el borrador, si hay, primero) y la única acción principal. Sin permiso, ningún botón de escritura. */
export function FichaDePlan({
  ficha,
  puede,
  aviso,
}: Readonly<{ ficha: FichaVista; puede: PermisosDePlanes; aviso: AvisoDeFicha }>) {
  const accion =
    !puede.editar || ficha.retirado ? null : (
      <EnlaceDeAccion href={`/planes/${encodeURIComponent(ficha.id)}/borrador`}>
        {ficha.borrador !== null
          ? textoDePlanes("plataforma.planes.editar_borrador")
          : ficha.ultima === null
            ? textoDePlanes("plataforma.planes.nueva_version_sin_base")
            : textoDePlanes("plataforma.planes.nueva_version", { n: ficha.ultima.numero ?? 0 })}
      </EnlaceDeAccion>
    );
  const textoDelAviso =
    aviso === "creado"
      ? textoDePlanes("plataforma.planes.plan_creado")
      : aviso === "existia"
        ? textoDePlanes("plataforma.planes.plan_ya_existia")
        : aviso === "publicada" && ficha.ultima?.numero != null
          ? textoDePlanes("plataforma.planes.publicada_aviso", { n: ficha.ultima.numero })
          : null;
  return (
    <>
      <p className={propios["migas"]}>
        <a className={estilos["enlaceSimple"]} href="/planes">
          {textoDePlanes("plataforma.planes.titulo")}
        </a>{" "}
        / {ficha.codigo}
      </p>
      {textoDelAviso === null ? null : (
        <Aviso tono="exito">
          <Texto>{textoDelAviso}</Texto>
        </Aviso>
      )}
      <div className={propios["acciones"]}>
        <Insignia tono={ficha.retirado ? "neutro" : "exito"}>
          {textoDePlanes(
            ficha.retirado
              ? "plataforma.planes.estado_retirado"
              : "plataforma.planes.estado_activo",
          )}
        </Insignia>
        {accion}
      </div>
      <section aria-labelledby="titulo-de-versiones">
        <h2 id="titulo-de-versiones">{textoDePlanes("plataforma.planes.versiones")}</h2>
        <table className={estilos["tabla"]}>
          <caption>
            <SoloLector>{textoDePlanes("plataforma.planes.versiones")}</SoloLector>
          </caption>
          <thead>
            <tr>
              <th scope="col">{textoDePlanes("plataforma.planes.col_version")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.col_estado")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.nombre_comercial")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.modulos")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.col_clientes_version")}</th>
              <th scope="col">{textoDePlanes("plataforma.planes.version_publicada")}</th>
            </tr>
          </thead>
          <tbody>
            {ficha.borrador === null ? null : <FilaDeVersion plan={ficha.id} v={ficha.borrador} />}
            {ficha.publicadas.map((v) => (
              <FilaDeVersion key={v.id} plan={ficha.id} v={v} />
            ))}
          </tbody>
        </table>
        <p className={propios["migas"]}>{textoDePlanes("plataforma.planes.ficha_aviso")}</p>
      </section>
    </>
  );
}
