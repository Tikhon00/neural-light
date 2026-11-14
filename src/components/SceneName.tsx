import { useState } from "react";

/** The outgoing copy is visual only; assistive technology reads one heading. */
export function SceneName({ name }: { name: string }) {
  const [names, setNames] = useState({
    current: name,
    previous: "",
    revision: 0,
  });
  if (names.current !== name)
    setNames({
      current: name,
      previous: names.current,
      revision: names.revision + 1,
    });
  return (
    <h1 className="scene-name" aria-label={name}>
      {names.previous && (
        <span
          key={`old-${names.revision}`}
          className="scene-name-previous"
          aria-hidden="true"
        >
          {names.previous}
        </span>
      )}
      <span
        key={names.revision}
        className={names.revision ? "scene-name-current" : undefined}
        aria-hidden="true"
      >
        {name}
      </span>
    </h1>
  );
}
