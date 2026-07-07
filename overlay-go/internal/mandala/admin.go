package mandala

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/bsv-blockchain/go-sdk/script"
)

type AdminDecoded struct {
	PubKeyHash [20]byte
	PublicData map[string]any
}

func DecodeAdmin(s *script.Script) (*AdminDecoded, error) {
	chunks, err := s.Chunks()
	if err != nil {
		return nil, err
	}
	d := &AdminDecoded{}
	p2pkh := chunks
	if len(chunks) == 7 { // publicData variant: <push json> OP_DROP <p2pkh...>
		if chunks[1].Op != script.OpDROP || len(chunks[0].Data) == 0 {
			return nil, fmt.Errorf("not a mandala admin output")
		}
		var pd map[string]any
		if err := json.Unmarshal(chunks[0].Data, &pd); err != nil {
			return nil, fmt.Errorf("admin publicData: %w", err)
		}
		d.PublicData = pd
		p2pkh = chunks[2:]
	} else if len(chunks) != 5 {
		return nil, fmt.Errorf("not a mandala admin output: %d chunks", len(chunks))
	}
	if p2pkh[0].Op != script.OpDUP || p2pkh[1].Op != script.OpHASH160 ||
		p2pkh[3].Op != script.OpEQUALVERIFY || p2pkh[4].Op != script.OpCHECKSIG ||
		len(p2pkh[2].Data) != 20 {
		return nil, fmt.Errorf("not a mandala admin output: p2pkh shape")
	}
	copy(d.PubKeyHash[:], p2pkh[2].Data)
	return d, nil
}

// canonicalize matches the TS commitment() canonical form: objects get
// byte-sorted keys, arrays keep order, primitives use JS JSON.stringify
// formatting (Appendix A §1.4).
func canonicalize(v any, b *strings.Builder) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		enc, err := json.Marshal(x)
		if err != nil {
			return err
		}
		b.Write(enc)
	case float64:
		if x == math.Trunc(x) && math.Abs(x) < 1e21 {
			b.WriteString(strconv.FormatFloat(x, 'f', -1, 64))
		} else {
			b.WriteString(strconv.FormatFloat(x, 'g', -1, 64))
		}
	case json.Number:
		b.WriteString(x.String())
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalize(e, b); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			enc, _ := json.Marshal(k)
			b.Write(enc)
			b.WriteByte(':')
			if err := canonicalize(x[k], b); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("commitment: unsupported type %T", v)
	}
	return nil
}

func Commitment(details map[string]any) (string, error) {
	var b strings.Builder
	if err := canonicalize(details, &b); err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:]), nil
}
