"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getClientFirestore, getClientStorage } from "@/lib/firebase/client";

type Ingredient = {
  key: string;
  name: string;
};

type CocktailIngredient = {
  key: string;
  measure: string | null;
  name: string;
};

type Cocktail = {
  alcoholic: string | null;
  category: string | null;
  glass: string | null;
  id: string;
  ingredientCount: number;
  ingredientKeys: string[];
  ingredients: CocktailIngredient[];
  instructions: string | null;
  name: string;
  sourceThumbnail?: string | null;
  storageThumbnailPath?: string | null;
  thumbnail: string | null;
};

type MatchResult = {
  canMake: Cocktail[];
  couldMake: Array<{
    cocktail: Cocktail;
    missingIngredients: CocktailIngredient[];
  }>;
};

type MixologistFixture = {
  cocktails: Cocktail[];
  ingredients: Ingredient[];
};

type ImageSyncState = {
  failed: number;
  phase: string;
  processed: number;
  skipped: number;
  total: number;
};

declare global {
  interface Window {
    __MIXOLOGIST_FIXTURE__?: MixologistFixture;
  }
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function getMissingIngredients(cocktail: Cocktail, selected: Set<string>) {
  return cocktail.ingredients.filter((ingredient) => !selected.has(ingredient.key));
}

function buildMatchResults(cocktails: Cocktail[], selectedKeys: string[]): MatchResult {
  const selected = new Set(selectedKeys);

  if (selected.size === 0) {
    return {
      canMake: [],
      couldMake: [],
    };
  }

  const canMake: Cocktail[] = [];
  const couldMake: Array<{
    cocktail: Cocktail;
    missingIngredients: CocktailIngredient[];
  }> = [];

  for (const cocktail of cocktails) {
    const missingIngredients = getMissingIngredients(cocktail, selected);

    if (missingIngredients.length === 0) {
      canMake.push(cocktail);
      continue;
    }

    if (missingIngredients.length === 1) {
      couldMake.push({
        cocktail,
        missingIngredients,
      });
    }
  }

  return {
    canMake: sortByName(canMake),
    couldMake: [...couldMake].sort((left, right) =>
      left.cocktail.name.localeCompare(right.cocktail.name),
    ),
  };
}

function getVisibleIngredients(ingredients: Ingredient[], searchTerm: string) {
  if (!searchTerm) {
    return ingredients;
  }

  return ingredients.filter((ingredient) =>
    ingredient.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );
}

function getFixtureData() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.__MIXOLOGIST_FIXTURE__ ?? null;
}

function getFileExtension(contentType: string | null) {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function isFirebaseHostedImage(url: string | null | undefined) {
  if (!url) {
    return false;
  }

  return (
    url.includes("firebasestorage.googleapis.com") ||
    url.includes("storage.googleapis.com") ||
    url.includes("firebasestorage.app")
  );
}

function CocktailThumbnail({ name, thumbnail }: Pick<Cocktail, "name" | "thumbnail">) {
  if (!thumbnail) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-[1.25rem] bg-stone-200 text-xs font-semibold uppercase tracking-[0.25em] text-stone-500 sm:h-36 sm:w-36">
        No Image
      </div>
    );
  }

  return (
    <div className="h-28 w-full overflow-hidden rounded-[1.25rem] bg-stone-200 sm:h-36 sm:w-36">
      <Image
        alt={name}
        className="h-full w-full object-cover"
        height={144}
        loading="lazy"
        src={thumbnail}
        unoptimized
        width={144}
      />
    </div>
  );
}

export function MixologistApp() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [cocktails, setCocktails] = useState<Cocktail[]>([]);
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imageSyncError, setImageSyncError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingImages, setIsSyncingImages] = useState(false);
  const [imageSyncState, setImageSyncState] = useState<ImageSyncState>({
    failed: 0,
    phase: "Ready to sync cocktail images",
    processed: 0,
    skipped: 0,
    total: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setIsLoading(true);
      setError(null);

      try {
        const fixture = getFixtureData();

        if (fixture) {
          if (cancelled) {
            return;
          }

          setIngredients(sortByName(fixture.ingredients));
          setCocktails(sortByName(fixture.cocktails));
          return;
        }

        const db = getClientFirestore();
        const [ingredientSnapshot, cocktailSnapshot] = await Promise.all([
          getDocs(query(collection(db, "ingredients"), orderBy("name"))),
          getDocs(query(collection(db, "cocktails"), orderBy("name"))),
        ]);

        if (cancelled) {
          return;
        }

        const loadedIngredients = ingredientSnapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as Ingredient;
          return {
            key: data.key,
            name: data.name,
          };
        });

        const loadedCocktails = cocktailSnapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as Cocktail;
          return {
            alcoholic: data.alcoholic ?? null,
            category: data.category ?? null,
            glass: data.glass ?? null,
            id: data.id ?? docSnapshot.id,
            ingredientCount: data.ingredientCount ?? data.ingredientKeys?.length ?? 0,
            ingredientKeys: data.ingredientKeys ?? [],
            ingredients: data.ingredients ?? [],
            instructions: data.instructions ?? null,
            name: data.name,
            thumbnail: data.thumbnail ?? null,
          };
        });

        setIngredients(sortByName(loadedIngredients));
        setCocktails(sortByName(loadedCocktails));
      } catch (caughtError) {
        if (!cancelled) {
          const message =
            caughtError instanceof Error ? caughtError.message : "Failed to load catalog";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const deferredSelectedIngredients = useDeferredValue(selectedIngredients);

  const visibleIngredients = useMemo(
    () => getVisibleIngredients(ingredients, deferredSearchTerm).slice(0, 80),
    [deferredSearchTerm, ingredients],
  );

  const selectedIngredientSet = useMemo(
    () => new Set(selectedIngredients),
    [selectedIngredients],
  );

  const matchResults = useMemo(
    () => buildMatchResults(cocktails, deferredSelectedIngredients),
    [cocktails, deferredSelectedIngredients],
  );

  function toggleIngredient(ingredientKey: string) {
    startTransition(() => {
      setSelectedIngredients((current) =>
        current.includes(ingredientKey)
          ? current.filter((item) => item !== ingredientKey)
          : [...current, ingredientKey].sort(),
      );
    });
  }

  function clearSelection() {
    startTransition(() => {
      setSelectedIngredients([]);
      setSearchTerm("");
    });
  }

  async function handleImageSync() {
    if (isLoading || cocktails.length === 0) {
      return;
    }

    setIsSyncingImages(true);
    setImageSyncError(null);
    setImageSyncState({
      failed: 0,
      phase: "Preparing cocktail image sync",
      processed: 0,
      skipped: 0,
      total: cocktails.length,
    });

    const db = getClientFirestore();
    const storage = getClientStorage();
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const cocktail of cocktails) {
      if (!cocktail.thumbnail) {
        skipped += 1;
        setImageSyncState({
          failed,
          phase: `Skipping ${cocktail.name}: no source thumbnail`,
          processed,
          skipped,
          total: cocktails.length,
        });
        continue;
      }

      if (cocktail.storageThumbnailPath || isFirebaseHostedImage(cocktail.thumbnail)) {
        skipped += 1;
        setImageSyncState({
          failed,
          phase: `Skipping ${cocktail.name}: already stored in Firebase`,
          processed,
          skipped,
          total: cocktails.length,
        });
        continue;
      }

      try {
        setImageSyncState({
          failed,
          phase: `Downloading ${cocktail.name}`,
          processed,
          skipped,
          total: cocktails.length,
        });

        const imageResponse = await fetch(
          `/api/cocktail-image?url=${encodeURIComponent(cocktail.thumbnail)}`,
          { cache: "no-store" },
        );

        if (!imageResponse.ok) {
          throw new Error(`Image proxy failed with status ${imageResponse.status}`);
        }

        const imageBlob = await imageResponse.blob();
        const contentType = imageBlob.type || imageResponse.headers.get("content-type");
        const extension = getFileExtension(contentType);
        const storagePath = `cocktails/${cocktail.id}/thumbnail.${extension}`;
        const storageRef = ref(storage, storagePath);

        setImageSyncState({
          failed,
          phase: `Uploading ${cocktail.name}`,
          processed,
          skipped,
          total: cocktails.length,
        });

        await uploadBytes(storageRef, imageBlob, {
          contentType: contentType ?? "image/jpeg",
        });

        const firebaseImageUrl = await getDownloadURL(storageRef);

        await updateDoc(doc(db, "cocktails", cocktail.id), {
          sourceThumbnail: cocktail.thumbnail,
          storageThumbnailPath: storagePath,
          thumbnail: firebaseImageUrl,
          updatedAt: serverTimestamp(),
        });

        processed += 1;
        setCocktails((current) =>
          current.map((item) =>
            item.id === cocktail.id
              ? {
                  ...item,
                  sourceThumbnail: cocktail.thumbnail,
                  storageThumbnailPath: storagePath,
                  thumbnail: firebaseImageUrl,
                }
              : item,
          ),
        );
        setImageSyncState({
          failed,
          phase: `Synced ${cocktail.name}`,
          processed,
          skipped,
          total: cocktails.length,
        });
      } catch (caughtError) {
        failed += 1;
        const message =
          caughtError instanceof Error ? caughtError.message : "Unknown image sync error";
        setImageSyncError(message);
        setImageSyncState({
          failed,
          phase: `Failed on ${cocktail.name}`,
          processed,
          skipped,
          total: cocktails.length,
        });
      }
    }

    setImageSyncState({
      failed,
      phase: "Cocktail image sync complete",
      processed,
      skipped,
      total: cocktails.length,
    });
    setIsSyncingImages(false);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(252,211,77,0.28),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.16),_transparent_30%),linear-gradient(180deg,_#fffaf2_0%,_#f8ead6_48%,_#edd5b2_100%)] px-4 py-6 text-stone-900 sm:px-8 sm:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-[0_20px_80px_rgba(120,74,18,0.12)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
                Mixologist
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl">
                Pick what you’ve got. We’ll tell you what’s pourable.
              </h1>
              <p className="mt-4 text-lg leading-8 text-stone-700">
                Choose your ingredients and the cocktail list updates live with
                drinks you can make right now, plus drinks you are just one
                bottle or garnish away from.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50">
                {selectedIngredients.length} selected
              </div>
              <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800">
                {matchResults.canMake.length} can make
              </div>
              <div className="rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800">
                {matchResults.couldMake.length} one away
              </div>
              <button
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={selectedIngredients.length === 0}
                onClick={clearSelection}
                type="button"
              >
                Clear selection
              </button>
              <button
                className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-300"
                disabled={isLoading || isSyncingImages || cocktails.length === 0}
                onClick={handleImageSync}
                type="button"
              >
                {isSyncingImages ? "Syncing images..." : "Sync Cocktail Images"}
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-[1.75rem] border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-[0_18px_60px_rgba(120,40,40,0.1)]">
            <h2 className="text-lg font-semibold">Couldn’t load your cocktail catalog</h2>
            <p className="mt-2 leading-7">{error}</p>
          </section>
        ) : null}

        <section className="rounded-[1.75rem] border border-white/60 bg-white/80 p-6 shadow-[0_18px_60px_rgba(120,74,18,0.1)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-stone-950">Image sync</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
                This button downloads each cocktail thumbnail from CocktailDB,
                uploads it into Firebase Storage, and rewrites the cocktail
                document to use the Firebase-hosted image.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                {imageSyncState.processed} synced
              </div>
              <div className="rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                {imageSyncState.skipped} skipped
              </div>
              <div className="rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                {imageSyncState.failed} failed
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border border-stone-200 bg-stone-950 p-5 text-stone-50">
            <p className="text-sm uppercase tracking-[0.25em] text-stone-400">Status</p>
            <p className="mt-3 text-lg">{imageSyncState.phase}</p>
            <p className="mt-2 text-sm text-stone-300">
              {imageSyncState.processed + imageSyncState.skipped + imageSyncState.failed} /{" "}
              {imageSyncState.total || cocktails.length} cocktails handled
            </p>
          </div>

          {imageSyncError ? (
            <div className="mt-5 rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                Last image sync error
              </p>
              <p className="mt-2 leading-7">{imageSyncError}</p>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <aside className="rounded-[1.75rem] border border-white/60 bg-white/80 p-6 shadow-[0_18px_60px_rgba(120,74,18,0.1)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-stone-950">Your ingredients</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Search and tap ingredients to build your home bar.
                </p>
              </div>

              <label className="block">
                <span className="sr-only">Search ingredients</span>
                <input
                  className="h-12 w-full rounded-full border border-stone-200 bg-stone-50 px-4 text-sm outline-none transition focus:border-amber-500 focus:bg-white sm:w-72"
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search ingredients"
                  type="search"
                  value={searchTerm}
                />
              </label>
            </div>

            <div className="mt-6 flex max-h-[34rem] flex-wrap gap-3 overflow-y-auto pr-2">
              {isLoading ? (
                <p className="text-sm text-stone-600">Loading ingredients from Firestore...</p>
              ) : visibleIngredients.length > 0 ? (
                visibleIngredients.map((ingredient) => {
                  const isSelected = selectedIngredientSet.has(ingredient.key);

                  return (
                    <button
                      key={ingredient.key}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        isSelected
                          ? "border-stone-950 bg-stone-950 text-stone-50 shadow-[0_12px_30px_rgba(28,25,23,0.22)]"
                          : "border-stone-200 bg-white text-stone-700 hover:border-amber-500 hover:text-stone-950"
                      }`}
                      onClick={() => toggleIngredient(ingredient.key)}
                      type="button"
                    >
                      {ingredient.name}
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-stone-600">No ingredients match that search yet.</p>
              )}
            </div>
          </aside>

          <div className="grid gap-6">
            <section className="rounded-[1.75rem] border border-white/60 bg-white/80 p-6 shadow-[0_18px_60px_rgba(120,74,18,0.1)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-stone-950">Can make</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Cocktails with every required ingredient already selected.
                  </p>
                </div>
                {isPending ? (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
                    Updating
                  </span>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4">
                {selectedIngredients.length === 0 ? (
                  <p className="rounded-3xl bg-stone-100 p-5 text-sm leading-7 text-stone-600">
                    Start by selecting an ingredient. Once you do, your makeable
                    cocktails will appear here.
                  </p>
                ) : matchResults.canMake.length > 0 ? (
                  matchResults.canMake.map((cocktail) => (
                    <article
                      key={cocktail.id}
                      className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-5"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <CocktailThumbnail
                          name={cocktail.name}
                          thumbnail={cocktail.thumbnail}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-xl font-semibold text-stone-950">
                                {cocktail.name}
                              </h3>
                              <p className="mt-2 text-sm text-stone-600">
                                {[cocktail.category, cocktail.alcoholic, cocktail.glass]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </p>
                            </div>
                            <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white">
                              Ready
                            </span>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {cocktail.ingredients.map((ingredient) => (
                              <span
                                key={`${cocktail.id}-${ingredient.key}`}
                                className="rounded-full bg-white px-3 py-1 text-sm text-stone-700"
                              >
                                {ingredient.measure
                                  ? `${ingredient.name} · ${ingredient.measure}`
                                  : ingredient.name}
                              </span>
                            ))}
                          </div>

                          {cocktail.instructions ? (
                            <p className="mt-4 text-sm leading-7 text-stone-700">
                              {cocktail.instructions}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="rounded-3xl bg-stone-100 p-5 text-sm leading-7 text-stone-600">
                    Nothing is fully covered yet. Add a few more ingredients and
                    this list will spring to life.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/60 bg-white/80 p-6 shadow-[0_18px_60px_rgba(120,74,18,0.1)]">
              <div>
                <h2 className="text-2xl font-semibold text-stone-950">Could make</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Drinks where you are exactly one ingredient short.
                </p>
              </div>

              <div className="mt-5 grid gap-4">
                {selectedIngredients.length === 0 ? (
                  <p className="rounded-3xl bg-stone-100 p-5 text-sm leading-7 text-stone-600">
                    Pick a couple of ingredients and we’ll surface the nearly-there cocktails.
                  </p>
                ) : matchResults.couldMake.length > 0 ? (
                  matchResults.couldMake.map(({ cocktail, missingIngredients }) => (
                    <article
                      key={cocktail.id}
                      className="rounded-[1.5rem] border border-amber-100 bg-amber-50/70 p-5"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <CocktailThumbnail
                          name={cocktail.name}
                          thumbnail={cocktail.thumbnail}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-xl font-semibold text-stone-950">
                                {cocktail.name}
                              </h3>
                              <p className="mt-2 text-sm text-stone-600">
                                Missing: {missingIngredients.map((item) => item.name).join(", ")}
                              </p>
                            </div>
                            <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-white">
                              One away
                            </span>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {cocktail.ingredients.map((ingredient) => {
                              const isMissing = missingIngredients.some(
                                (item) => item.key === ingredient.key,
                              );

                              return (
                                <span
                                  key={`${cocktail.id}-${ingredient.key}`}
                                  className={`rounded-full px-3 py-1 text-sm ${
                                    isMissing
                                      ? "bg-amber-200 text-amber-950"
                                      : "bg-white text-stone-700"
                                  }`}
                                >
                                  {ingredient.measure
                                    ? `${ingredient.name} · ${ingredient.measure}`
                                    : ingredient.name}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="rounded-3xl bg-stone-100 p-5 text-sm leading-7 text-stone-600">
                    No one-away cocktails yet. That usually means your current
                    picks are either too narrow or already covering complete drinks.
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
