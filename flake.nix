{
  description = "MedSearch — static site generator for Belgium's SAM v2 medication database";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            pagefind
            curl
            unzip
            util-linux  # prlimit
          ];

          shellHook = ''
            echo "MedSearch build environment"
            echo "  bun:      $(bun --version)"
            echo "  pagefind: $(pagefind --version)"
            echo ""
            echo "Steps:  nix build .#database  →  nix build .#html  →  nix build .#site"
            echo "Full:   nix build"
            echo "Dev:    ./build.sh [--skip-fetch] [--skip-import]"
          '';
        };

        packages = {
          # Step 1: SAM XML → SQLite database
          # Requires SAM XML files in data/sam-export/ (run ./fetch-sam.sh first)
          database = pkgs.stdenv.mkDerivation {
            name = "medsearch-database";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=$TMPDIR/medsearch.sqlite
              bun run scripts/sync-sam-database.ts --skip-download --verbose
            '';
            installPhase = ''
              cp $TMPDIR/medsearch.sqlite $out
            '';
          };

          # Step 2: SQLite database → HTML pages
          html = pkgs.stdenv.mkDerivation {
            name = "medsearch-html";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=${self.packages.${system}.database}
              bun run generator/index.ts
            '';
            installPhase = ''
              cp -r dist $out
            '';
          };

          # Step 3: HTML pages → HTML + Pagefind search index
          site = pkgs.stdenv.mkDerivation {
            name = "medsearch-site";
            src = self.packages.${system}.html;
            nativeBuildInputs = with pkgs; [ pagefind util-linux ];
            buildPhase = ''
              cp -r $src site
              chmod -R u+w site
              ionice -c 3 nice -n 15 prlimit --as=4000000000 -- pagefind --site site --output-subdir _search
            '';
            installPhase = ''
              cp -r site $out
            '';
          };

          # Full pipeline (default target)
          default = self.packages.${system}.site;
        };
      }
    );
}
