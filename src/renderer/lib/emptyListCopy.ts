export interface EmptyListCopy {
  title: string;
  body: string;
  canClearSearch: boolean;
}

// Picks empty-list copy that tells a search miss apart from an empty list.
export function emptyListCopy(
  noun: { singular: string; plural: string },
  searchQuery: string,
  totalCount: number,
): EmptyListCopy {
  if (searchQuery.length > 0 && totalCount > 0) {
    const shown = searchQuery.trim() || searchQuery;
    return {
      title: `No ${noun.plural} match “${shown}”`,
      body: `You have ${totalCount} ${totalCount === 1 ? noun.singular : noun.plural}. Check the spelling or clear the search.`,
      canClearSearch: true,
    };
  }
  return {
    title: `No ${noun.plural} yet`,
    body: `Create your first ${noun.singular} to get started.`,
    canClearSearch: false,
  };
}
